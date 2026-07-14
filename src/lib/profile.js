'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Сохраняет callgrind-дамп в локально файл.
 * @param {string} callgrindData — строка callgrind-формата (работаем просто как со строкой)
 * @param {string} scenarioName — имя сценария (пойдет в имя файла)
 * @param {string} profilesDir — путь к папке для callgrind-файлов
 * @returns {string} путь к созданному файлу
 */
function saveCallgrind(callgrindData, scenarioName, profilesDir) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${scenarioName}-${timestamp}.callgrind`;
    const filePath = path.join(profilesDir, filename);
    fs.mkdirSync(profilesDir, { recursive: true });
    fs.writeFileSync(filePath, callgrindData, 'utf8');
    return filePath;
}

module.exports = { saveCallgrind };
