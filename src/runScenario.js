'use strict';

const { once } = require('events');

/**
 * @typedef {import('./lib/types').ScenarioOutput} ScenarioOutput
 * @typedef {import('./lib/types').WorkerMessage} WorkerMessage
 */

/**
 * Worker entry point для запуска одного сценария.
 *
 * Каждый сценарий изолирован в отдельном дочернем процессе (`child_process.fork`).
 * Это гарантирует, что mockup-сервер и его дочерние процессы (storage,
 * engine_runner, engine_processor) не разделяют state между сценариями,
 * а при завершении/убийстве воркера ОС может корректно прибить всё дерево
 * процессов.
 *
 * Поддерживает три статуса:
 * - pass — сценарий прошёл успешно
 * - skip — сценарий пропущен (result.skipped === true)
 * - fail — сценарий упал с ошибкой
 *
 * process.exit(0) вызывается после отправки сообщения,
 * т.к. server.stop() не полностью освобождает storage (утечка файловых дескрипторов).
 *
 * @example
 * // Запуск из bin/screeps-integration-tests.js:
 * const cp = require('child_process');
 * const child = cp.fork('src/runScenario.js');
 * child.send({ scenarioPath: './scenarios/smoke-empty.scenario.js', opts: { profiling: false } });
 * child.on('message', (msg) => console.log(msg.status)); // 'pass'
 */

(async () => {
    try {
        const [msg] = await once(process, 'message');

        // Загружаем пользовательские room fixtures ДО require сценария,
        // чтобы они были доступны через публичный API.
        if (msg.roomFixturesDir) {
            const { loadRoomFixturesFromDir } = require('./lib/fixtures/roomFixture');
            loadRoomFixturesFromDir(msg.roomFixturesDir);
        }

        const scenario = require(msg.scenarioPath);
        const opts = msg.opts || {};
        const result = await scenario.run(opts);

        /** @type {WorkerMessage} */
        const message = result?.skipped ? { status: 'skip', result } : { status: 'pass', result };

        process.send(message);
    } catch (e) {
        /** @type {WorkerMessage} */
        const message = {
            status: 'fail',
            error: e.stack || String(e),
        };
        process.send(message);
    } finally {
        // Завершение worker process.
        // server.stop() не полностью освобождает storage — process.exit() необходим.
        // Небольшая задержка (100ms) чтобы сообщение успело доставиться в parent.
        setTimeout(() => process.exit(0), 100);
    }
})();
