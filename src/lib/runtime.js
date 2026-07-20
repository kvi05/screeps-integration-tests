'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { EventEmitter, once } = require('events');
const { ScreepsServer } = require('screeps-server-mockup');
const { createStorageAdapter } = require('./storageAdapter');
const { loadBotModules } = require('./loadBot');

/**
 * @typedef {import('./types').ScreepsServer} ScreepsServer
 * @typedef {import('./storageAdapter').StorageAdapter} StorageAdapter
 * @typedef {import('./types').Bot} Bot
 * @typedef {import('./types').BotSpec} BotSpec
 * @typedef {import('./types').RuntimeOpts} RuntimeOpts
 * @typedef {import('./types').RuntimeResult} RuntimeResult
 * @typedef {import('./types').PrepareServerOpts} PrepareServerOpts
 * @typedef {import('./types').PreparedServer} PreparedServer
 * @typedef {import('./types').AddBotsOpts} AddBotsOpts
 * @typedef {import('./types').AddedBots} AddedBots
 * @typedef {import('./types').DisposeFn} DisposeFn
 */

/**
 * Возвращает свободный TCP-порт на 127.0.0.1.
 *
 * Используется, чтобы каждый mockup-сервер работал на своём порту и не
 * конфликтовал с другими параллельными/последовательными запусками.
 *
 * @returns {Promise<number>}
 */
async function getFreePort() {
    const server = net.createServer();
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => {
                server.removeAllListeners();
                resolve(port);
            });
        });
    });
}

/**
 * Создаёт mockup-сервер, комнаты и terrain.
 *
 * Runtime не создаёт игровые объекты: controller и остальные объекты комнаты
 * материализуются через builders. Это позволяет оставить controller
 * необязательным для комнат без ботов и без controller в спецификации.
 *
 * Сервер намеренно не запускается до добавления ботов и materialize-объектов.
 * `addBot` работает с подготовленным, но ещё не запущенным сервером, как и
 * в прежнем pipeline.
 *
 * @param {PrepareServerOpts} opts
 * @returns {Promise<PreparedServer>}
 */
async function prepareServer(opts) {
    if (!opts.rooms || opts.rooms.length === 0) {
        throw new Error('prepareServer: opts.rooms обязателен и должен быть непустым массивом');
    }

    const cacheDir = opts.cacheDir || path.join(__dirname, '..', '.cache', String(process.pid));
    const port = opts.port ?? (await getFreePort());

    // screeps-server-mockup пишет логи в ./server/logs относительно cwd.
    // Создаём папку автоматически, чтобы пользователю не приходилось держать
    // её вручную в своём репозитории.
    fs.mkdirSync(path.join(process.cwd(), 'server', 'logs'), { recursive: true });

    const server = new ScreepsServer({ path: cacheDir, port });

    await server.world.reset();

    const adapter = createStorageAdapter(server);

    for (const roomName of opts.rooms) {
        await prepareRoom(adapter, roomName);
    }

    return { server, adapter, dispose: createDispose(server, adapter, cacheDir) };
}

/**
 * Добавляет ботов в подготовленный сервер.
 *
 * Runtime-уровневая функция: вставляет пользователя, memory, код, console и
 * привязывает бота к ACTIVE_ROOMS. **Не трогает** controller и **не вставляет**
 * spawn автоматически — эти объекты полностью принадлежат materialize-слою.
 *
 * @param {AddBotsOpts} opts
 * @returns {Promise<AddedBots>}
 */
async function addBots(opts) {
    /** @type {BotSpec[]} */
    const botsList = opts.bots || [];
    /** @type {Object<string,Bot>} */
    const bots = {};
    /** @type {Object<string,import('./types').ResolvedBotSpec>} */
    const resolvedBots = {};

    for (const b of botsList) {
        // Резолюция per-bot: приоритет local > global > default false.
        const effectiveProfiling = b.profiling ?? opts.profiling ?? false;
        const modules =
            b.modules ||
            loadBotModules(opts.distDir, {
                profiling: effectiveProfiling,
            });

        const bot = await addBot(opts.adapter, b.username, {
            room: b.room,
            cpu: b.cpu,
            cpuAvailable: b.cpuAvailable,
            gcl: b.gcl,
            modules,
        });

        bots[b.username] = bot;
        resolvedBots[b.username] = {
            ...b,
            effectiveProfiling,
        };
    }

    return { bots, resolvedBots };
}

/**
 * Собственная реализация addBot без побочных эффектов mockup-метода.
 *
 * Создаёт пользователя, memory, users.code, ACTIVE_ROOMS и console-события.
 *
 * Controller и spawn намеренно не трогает: они принадлежат materialize-слою.
 *
 * @param {StorageAdapter} adapter
 * @param {string} username
 * @param {Object} [opts]
 * @param {number} [opts.cpu=100]
 * @param {number} [opts.cpuAvailable=10000]
 * @param {number} [opts.gcl=1]
 * @param {Object} [opts.modules={}]
 * @returns {Promise<Bot>}
 */
async function addBot(adapter, username, opts = {}) {
    const { db, env } = adapter;
    const user = await db.users.insert({
        username,
        cpu: opts.cpu ?? 100,
        cpuAvailable: opts.cpuAvailable ?? 10000,
        gcl: opts.gcl ?? 1,
        active: 10000,
        badge: adapter.world.genRandomBadge(),
    });

    await Promise.all([
        env.set(env.keys.MEMORY + user._id, '{}'),
        env.sadd(env.keys.ACTIVE_ROOMS, opts.room),
        db.rooms.update({ _id: opts.room }, { $set: { active: true } }),
        db['users.code'].insert({
            user: user._id,
            branch: 'default',
            modules: opts.modules || {},
            activeWorld: true,
        }),
    ]);

    return new TestBot(adapter, user).init();
}

/**
 * Минимальный объект бота, совместимый с API, который использует framework.
 * Подписка на console сделана здесь, а не через User из mockup, чтобы runtime
 * не зависел от реализации `world.addBot`.
 */
class TestBot extends EventEmitter {
    constructor(adapter, data) {
        super();
        this._adapter = adapter;
        this._id = data._id;
        this._username = data.username;
    }

    get id() {
        return this._id;
    }

    get username() {
        return this._username;
    }

    get memory() {
        const { env } = this._adapter;
        return env.get(env.keys.MEMORY + this._id);
    }

    async console(expression) {
        const { db } = this._adapter;
        return db['users.console'].insert({ user: this._id, expression, hidden: false });
    }

    async init() {
        const { pubsub } = this._adapter;
        await pubsub.subscribe(`user:${this._id}/console`, (event) => {
            const data = JSON.parse(event);
            const { messages, error } = data;
            const { log = [], results = [] } = messages || {};
            if (error) {
                log.push(error);
            }
            this.emit('console', log, results, this._id, this._username);
        });
        return this;
    }
}

/**
 * facade runtime API.
 *
 * Полный world pipeline: prepareServer → addBots → buildCanonicalRoom →
 * materializeRoom → server.start. `createRuntime` упрощает этот контракт
 * для прямых потребителей.
 *
 * @param {RuntimeOpts} opts
 * @returns {Promise<RuntimeResult>}
 */
async function createRuntime(opts) {
    const prepared = await prepareServer({
        rooms: opts.rooms,
        cacheDir: opts.cacheDir,
        port: opts.port,
    });

    try {
        const added = await addBots({
            adapter: prepared.adapter,
            bots: opts.bots || [],
            distDir: opts.distDir,
            profiling: opts.profiling,
        });
        await prepared.server.start();
        return { ...prepared, ...added };
    } catch (error) {
        await prepared.dispose();
        throw error;
    }
}

/**
 * Создаёт комнату и terrain без controller.
 *
 * @param {StorageAdapter} adapter
 * @param {string} roomName
 * @returns {Promise<void>}
 */
async function prepareRoom(adapter, roomName) {
    await adapter.world.addRoom(roomName);

    // addRoom() не создаёт terrain — добавляем plain terrain, чтобы processor
    // не падал на первом тике.
    try {
        await adapter.world.getTerrain(roomName);
    } catch {
        const TerrainMatrix = require('screeps-server-mockup/dist/src/terrainMatrix').default;
        await adapter.world.setTerrain(roomName, new TerrainMatrix());
    }
}

/**
 * Дожидается завершения дочернего процесса с таймаутом.
 *
 * @param {import('child_process').ChildProcess} proc
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
async function waitForProcessExit(proc, timeoutMs) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
        return;
    }

    const ac = new AbortController();
    const timer = setTimeout(() => {
        ac.abort();
        try {
            proc.kill('SIGKILL');
        } catch {
            // ignore
        }
    }, timeoutMs);

    try {
        await once(proc, 'exit', { signal: ac.signal });
    } catch {
        // AbortError — процесс уже убит таймером
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Создаёт единый безопасный dispose для всех runtime-фаз.
 *
 * Останавливает дочерние процессы сервера, дожидается их завершения и
 * удаляет cache-директорию. Это предотвращает утечку storage/engine
 * процессов и конфликты портов между последовательными запусками.
 *
 * @param {ScreepsServer} server
 * @param {StorageAdapter} adapter
 * @param {string} cacheDir
 * @returns {DisposeFn}
 */
function createDispose(server, adapter, cacheDir) {
    return async () => {
        const processes = adapter.getProcesses();

        for (const proc of processes) {
            try {
                proc.kill();
            } catch {
                // ignore
            }
        }

        await Promise.all(processes.map((proc) => waitForProcessExit(proc, 5000)));

        try {
            fs.rmSync(cacheDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    };
}

module.exports = { createRuntime, prepareServer, addBots, addBot, TestBot };
