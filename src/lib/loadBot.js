'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @typedef {import('./types').LoadBotOpts} LoadBotOpts
 */

/**
 * Собирает dist/*.js в map модулей для addBot({ modules }).
 * Ключ — имя файла без .js, значение — содержимое файла.
 * @param {string} distDir — путь к dist/ (результат build.js)
 * @param {LoadBotOpts} [opts]
 * @returns {Object<string,string>}
 */
function loadBotModules(distDir, opts = {}) {
    const modules = {};
    const entries = fs.readdirSync(distDir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.js')) {
            const name = entry.name.replace(/\.js$/, '');
            let code = fs.readFileSync(path.join(distDir, entry.name), 'utf8');

            // Инжект профайлера в main.js (обёртка loop).
            // Профайлер работает в бесконечном режиме (background): disableTick=false,
            // поэтому завершение по таймеру недостижимо. Итоговый экспорт output()/callgrind()
            // управляется харнесом через флаг Memory.__profileFinalize (см. world.exportProfiles).
            //
            // Порядок внутри tick ВАЖЕН: __origLoop (оригинальный loop бота) вызывает
            // profiler.wrap() → setupProfiler(), который СОЗДАЁТ Game.profiler. Поэтому
            // Game.profiler.background() вызывается ПОСЛЕ __origLoop, иначе Game.profiler
            // ещё не существует в этом тике.
            //
            // Поток:
            //   tick 0 — __origLoop → profiler.wrap → setupProfiler → Game.profiler создан;
            //   tick 1 — __origLoop (сбор данных), затем Game.profiler.background() →
            //     создаётся Memory.profiler с enabledTick = Game.time + 1;
            //   tick 2+ — __origLoop (профайлер собирает данные через Profiler.endTick);
            //   финализационный тик — обёртка видит __profileFinalize, экспортирует
            //     output()/callgrind() в Memory и НЕ вызывает __origLoop, чтобы не
            //     искажать статистику лишним тиком работы бота.
            if (opts.profiling && name === 'main') {
                code += `
const __origLoop = module.exports.loop;
module.exports.loop = function() {
    if (Memory.__profileFinalize) {
        delete Memory.__profileFinalize;
        if (Memory.profiler && Memory.profiler.enabledTick) {
            try {
                var profiler = require('screeps-profiler');
                Memory.__profileCallgrind = profiler.callgrind();
                Memory.__profileText = profiler.output();
            } catch (e) { /* profiler export failed */ }
        }
        return;
    }

    __origLoop.call(this);

    if (Game.time === 1 && Game.profiler) {
        Game.profiler.background();
    }
};`;
            }

            modules[name] = code;
        }
    }
    return modules;
}

module.exports = { loadBotModules };
