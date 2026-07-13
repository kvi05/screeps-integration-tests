'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const treeKill = require('tree-kill');
const { saveCallgrind } = require('./lib/profile');
const { pruneCache } = require('./lib/cleanup');
const { once } = require('events');

/**
 * @typedef {import('./lib/types').CliOpts} CliOpts
 * @typedef {import('./lib/types').WorkerMessage} WorkerMessage
 * @typedef {import('./lib/types').SummaryEntry} SummaryEntry
 */

const SCENARIOS_DIR = path.join(__dirname, 'scenarios');
const PROFILES_DIR = path.join(__dirname, 'profiles');
const TIMEOUT_DEFAULT = 30 * 60 * 1000; // 30 минут
const CACHE_KEEP = 5; // хранить 5 последних кэшей
const JOBS_DEFAULT = Math.min(4, os.cpus().length);

/**
 * Парсит CLI аргументы.
 *
 * Флаги:
 *   --only <name>     Запустить только указанный сценарий
 *   --profiling       Включить профилирование (screeps-profiler + callgrind)
 *   --bail            Остановиться при первом падении
 *   --timeout <ms>    Таймаут на сценарий (по умолчанию 30 мин)
 *   --jobs <N>        Максимальное число параллельных сценариев
 *
 * @returns {CliOpts & { jobs: number }}
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        only: null,
        profiling: false,
        bail: false,
        timeout: TIMEOUT_DEFAULT,
        jobs: JOBS_DEFAULT,
    };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--only' && args[i + 1]) {
            opts.only = args[++i];
        } else if (args[i] === '--profiling') {
            opts.profiling = true;
        } else if (args[i] === '--bail') {
            opts.bail = true;
        } else if (args[i] === '--timeout' && args[i + 1]) {
            opts.timeout = parseInt(args[++i], 10);
        } else if (args[i] === '--jobs' && args[i + 1]) {
            const jobs = parseInt(args[++i], 10);
            opts.jobs = Number.isNaN(jobs) || jobs < 1 ? 1 : jobs;
        }
    }
    return opts;
}

/**
 * Находит все .scenario.js файлы в scenarios/.
 * Порядок: smoke-empty первый, потом по алфавиту.
 *
 * @param {string|null} only — имя сценария для фильтрации
 * @returns {string[]} — имена файлов (*.scenario.js)
 */
function findScenarios(only) {
    const files = fs
        .readdirSync(SCENARIOS_DIR)
        .filter((f) => f.endsWith('.scenario.js'))
        .sort((a, b) => {
            // smoke-empty всегда первый
            if (a.startsWith('smoke-')) {
                return -1;
            }
            if (b.startsWith('smoke-')) {
                return 1;
            }
            return a.localeCompare(b);
        });

    if (only) {
        const matched = files.find((f) => f.replace('.scenario.js', '') === only);
        if (!matched) {
            console.error(`[run-all] scenario "${only}" not found in ${SCENARIOS_DIR}`);
            process.exit(1);
        }
        return [matched];
    }

    return files;
}

/**
 * Пробрасывает stdout/stderr дочернего процесса в родительский.
 *
 * Фильтрует ожидаемые сообщения `@screeps/common` об обрыве соединения с
 * storage, которые возникают при корректном завершении mockup-сервера.
 *
 * @param {import('child_process').ChildProcess} child
 */
function pipeChildStreams(child) {
    if (child.stdout) {
        child.stdout.pipe(process.stdout);
    }

    if (!child.stderr) {
        return;
    }

    let buffer = '';
    let droppingStorageError = false;

    child.stderr.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop(); // незавершённая строка остаётся в буфере

        for (const line of lines) {
            if (droppingStorageError) {
                if (/^\s/.test(line) || line === '}') {
                    continue;
                }
                droppingStorageError = false;
            }

            if (line.includes('Storage connection lost')) {
                droppingStorageError = true;
                continue;
            }
            if (line.includes('Connecting to storage')) {
                continue;
            }

            process.stderr.write(`${line}\n`);
        }
    });

    child.stderr.on('end', () => {
        if (!buffer) {
            return;
        }
        if (droppingStorageError && (/^\s/.test(buffer) || buffer === '}')) {
            return;
        }
        if (buffer.includes('Storage connection lost') || buffer.includes('Connecting to storage')) {
            return;
        }
        process.stderr.write(`${buffer}\n`);
    });
}

/**
 * Запускает один сценарий в дочернем процессе.
 *
 * @param {string} scenarioPath — абсолютный путь к .scenario.js
 * @param {Object} opts — опции для сценария (profiling, ...)
 * @param {number} timeout — таймаут (ms)
 * @returns {Promise<import('./runScenario').WorkerMessage & {time?: number}>}
 */
async function runScenarioInWorker(scenarioPath, opts, timeout) {
    const child = fork(path.join(__dirname, 'runScenario.js'), [], { silent: true });
    pipeChildStreams(child);
    const startTime = Date.now();

    const ac = new AbortController();
    const timer = setTimeout(() => {
        ac.abort();
        treeKill(child.pid, 'SIGKILL', () => {});
    }, timeout);

    try {
        await once(child, 'spawn', { signal: ac.signal });
        child.send({ scenarioPath, opts });

        const [msg] = await Promise.race([
            once(child, 'message', { signal: ac.signal }),
            once(child, 'error', { signal: ac.signal }).then(([err]) => Promise.reject(err)),
            once(child, 'exit', { signal: ac.signal }).then(([code, signal]) => {
                const reason = code !== null ? `exit code ${code}` : `signal ${signal}`;
                return Promise.reject(new Error(`Worker exited unexpectedly (${reason})`));
            }),
        ]);

        return { ...msg, time: Date.now() - startTime };
    } catch (err) {
        if (err.name === 'AbortError') {
            return { status: 'timeout', error: `Timeout after ${timeout}ms` };
        }
        if (err instanceof Error) {
            return { status: 'fail', error: err.stack || err.message };
        }
        return { status: 'fail', error: String(err) };
    } finally {
        clearTimeout(timer);
        child.removeAllListeners();
    }
}

/**
 * Печатает сводный отчёт по всем сценариям.
 *
 * @param {SummaryEntry[]} results
 * @returns {boolean} true если все прошли
 */
function printSummary(results) {
    console.log('\n========== SUMMARY ==========');
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const { name, status, error, time } of results) {
        const icon = status === 'pass' ? 'PASS' : status === 'skip' ? 'SKIP' : 'FAIL';
        const timeStr = time !== undefined ? ` (${Math.round(time / 1000)}s)` : '';
        console.log(`  ${icon} ${name}${timeStr}`);
        if (error) {
            console.log(`       ${error.split('\n')[0]}`);
        }
        if (status === 'pass') {
            passed++;
        } else if (status === 'skip') {
            skipped++;
        } else {
            failed++;
        }
    }

    console.log(`\n  Total: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    return failed === 0;
}

/**
 * Основная функция: запускает все сценарии паралледбно (с ограничением).
 *
 * Порядок выполнения:
 * 1. Парсинг CLI аргументов
 * 2. Очистка .cache (хранить CACHE_KEEP последних)
 * 3. Поиск сценариев
 * 4. Параллельный запуск в child_process.fork с пулом размера --jobs
 * 5. Сохранение profiling (callgrind) данных (если включён)
 * 6. Печать сводки
 * 7. exit(0) если все прошли, exit(1) если есть падения
 */
async function main() {
    const cliOpts = parseArgs();
    const scenarioFiles = findScenarios(cliOpts.only);
    /** @type {SummaryEntry[]} */
    const results = new Array(scenarioFiles.length);

    // Очистка кэша: хранить CACHE_KEEP последних директорий
    const cleanupResult = pruneCache({ keep: CACHE_KEEP });
    if (cleanupResult.removed > 0) {
        console.log(`[run-all] Cache cleanup: removed ${cleanupResult.removed}, kept ${cleanupResult.kept}`);
    }

    // Метка окружения для детекции из бота (опционально)
    process.env.INTEGRATION_TEST = '1';

    console.log(
        `\n[run-all] Found ${scenarioFiles.length} scenario(s), jobs: ${cliOpts.jobs}, timeout: ${cliOpts.timeout}ms`,
    );

    // SIGINT handler: корректная остановка при Ctrl+C
    let interrupted = false;
    const onSigInt = () => {
        interrupted = true;
        console.log('\n[run-all] SIGINT received, stopping...');
    };
    process.on('SIGINT', onSigInt);

    let failed = false;
    const iterator = scenarioFiles.entries();

    const workers = Array.from({ length: cliOpts.jobs }, async () => {
        for (const [index, file] of iterator) {
            if (interrupted || (cliOpts.bail && failed)) {
                break;
            }

            const name = file.replace('.scenario.js', '');
            const scenarioPath = path.join(SCENARIOS_DIR, file);
            const start = Date.now();

            process.stdout.write(`  Running ${name}...\n`);

            const result = await runScenarioInWorker(scenarioPath, { profiling: cliOpts.profiling }, cliOpts.timeout);

            const time = Date.now() - start;
            results[index] = { name, ...result, time };

            if (result.status !== 'pass' && result.status !== 'skip') {
                failed = true;
            }

            // Сохранение profiling (callgrind) данных (если включено и данные есть)
            if (cliOpts.profiling && result.status === 'pass' && result.result && result.result.profileCallgrind) {
                try {
                    for (const [username, data] of Object.entries(result.result.profileCallgrind)) {
                        const filePath = saveCallgrind(data, `${name}-${username}`, PROFILES_DIR);
                        console.log(`       callgrind (${username}): ${filePath}`);
                    }
                } catch (e) {
                    console.log(`       callgrind save failed: ${e.message}`);
                }
            }

            if (result.status === 'pass') {
                console.log(` PASS (${Math.round(time / 1000)}s)`);
            } else if (result.status === 'skip') {
                console.log(` SKIP`);
            } else {
                console.log(` FAIL (${Math.round(time / 1000)}s)`);
                if (result.error) {
                    console.log(`       ${result.error.split('\n').slice(0, 3).join('\n       ')}`);
                }
                if (cliOpts.bail) {
                    console.log('[run-all] --bail: stopping on first failure');
                }
            }
        }
    });

    await Promise.all(workers);

    process.removeListener('SIGINT', onSigInt);

    const allPassed = printSummary(results);
    process.exit(allPassed ? 0 : 1);
}

main().catch((e) => {
    console.error('[run-all] Fatal error:', e);
    process.exit(1);
});
