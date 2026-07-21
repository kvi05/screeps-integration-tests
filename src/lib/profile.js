'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Saves a callgrind dump to a local file.
 * @param {string} callgrindData — callgrind-formatted string (treated as a plain string)
 * @param {string} scenarioName — scenario name (used in the filename)
 * @param {string} profilesDir — path to the callgrind output directory
 * @returns {string} path to the created file
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
