module.exports = {};

/**
 * 0xC0: PM2.5 and PM10 data
 * 
 * @param {Buffer} data
 * @param {SensorState} state
 */

module.exports.handle0xC0 = (data, state) => {
    var lowBytePm25 = data.readUIntBE(2, 1);
    var highBytePm25 = data.readUIntBE(3, 1);

    var pm25 = ((highBytePm25 * 256) + lowBytePm25) / 10;

    var lowBytePm10 = data.readUIntBE(4, 1);
    var highBytePm10 = data.readUIntBE(5, 1);

    var pm10 = ((highBytePm10 * 256) + lowBytePm10) / 10;

    state.pm2p5 = pm25;
    state.pm10 = pm10;
};

/**
 * 0xC5: response to commands related to configuration setting
 * @param {Buffer} data
 * @param {SensorState} state
 */
module.exports.handle0xC5 = (data, state) => {
    var setting = data.readUIntBE(2, 1);

    switch (setting) {
        case 2: // Response to "get/set mode" command
            {
                const res = data.readUIntBE(4, 1);
                state.mode = (res == 0 ? 'active' : 'query');
            }
            break;

        case 6: // Response to "get/set sleep mode" command
            {
                const res = data.readUIntBE(4, 1);
                state.isSleeping = (res === 0);
            }
            break;

        case 7: // Response to "get firmware version" command
            {
                const year = data.readUIntBE(3, 1);
                const month = data.readUIntBE(4, 1);
                const day = data.readUIntBE(5, 1);

                state.firmware = `${year}-${month}-${day}`;
            }
            break;

        case 8: // Response to "get/set working period" command
            {
                const res = data.readUIntBE(4, 1);
                state.workingPeriod = res;
            }
            break;

        default:
            throw new Error(`Unhandled command: ${setting}`);
    }
};