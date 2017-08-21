const SerialPort = require('serialport');
const EventEmitter = require('events');

const ALLOWED_RETRIES = 10; // Number of retries allowed for single command request. 
const COMMAND_RETRY_INTERVAL = 150; // Time between sequential retries.

class SDS011Wrapper extends EventEmitter {

    /**
     * Open sensor.
     *
     * @param {string} portPath - Serial port path
     */
    constructor(portPath) {
        super();

        this._port = new SerialPort(portPath, { baudRate: 9600 });

        this._state = {
            workingPeriod: undefined,
            mode: undefined,
            isSleeping: undefined,
            firmware: undefined,
            pm2p5: undefined,
            pm10: undefined,
            closed: false
        };

        this._commandQueue = [];
        this._isCurrentlyProcessing = false;
        this._retryCount = 0;

        this._port.on('error', function (err) {
            console.log('Error: ', err.message);
        });

        /**
          * Listen for incoming data and react: change internal state so queued commands know that they were completed or emit data.
          */
        this._port.on('data', (data) => {

            //#region Packet handlers

            /**
            * 0xC0: PM2.5 and PM10 data
            */
            const handle0xC0 = (data) => {
                var lowBytePm25 = data.readUIntBE(2, 1);
                var highBytePm25 = data.readUIntBE(3, 1);

                var pm25 = ((highBytePm25 * 256) + lowBytePm25) / 10;

                var lowBytePm10 = data.readUIntBE(4, 1);
                var highBytePm10 = data.readUIntBE(5, 1);

                var pm10 = ((highBytePm10 * 256) + lowBytePm10) / 10;

                this._state.pm2p5 = pm25;
                this._state.pm10 = pm10;

                if (this._state.mode == 'active')
                    this.emit('measure', { 'PM2.5': pm25, 'PM10': pm10 });
            }

            /**
            * 0xC5: response to commands related to configuration setting
            */
            const handle0xC5 = (data) => {
                var setting = data.readUIntBE(2, 1);

                switch (setting) {
                    case 2: // Response to "get/set mode" command
                        {
                            const res = data.readUIntBE(4, 1);
                            this._state.mode = (res == 0 ? 'active' : 'query');
                        }
                        break;

                    case 6: // Response to "get/set sleep mode" command
                        {
                            const res = data.readUIntBE(4, 1);
                            this._state.isSleeping = (res === 0);
                        }
                        break;

                    case 7: // Response to "get firmware version" command
                        {
                            const year = data.readUIntBE(3, 1);
                            const month = data.readUIntBE(4, 1);
                            const day = data.readUIntBE(5, 1);

                            this._state.firmware = `${year}-${month}-${day}`;
                        }
                        break;

                    case 8: // Response to "get/set working period" command
                        {
                            const res = data.readUIntBE(4, 1);
                            this._state.workingPeriod = res;
                        }
                        break;

                    default:
                        console.log(`Unhandled setting: ${setting}`);
                }
            }

            //#endregion

            if (verifyPacket(data)) {
                var type = data.readUIntBE(1, 1); // Byte offset 1 is command type

                switch (type) {
                    case 0xC0:
                        handle0xC0(data);
                        break;

                    case 0xC5:
                        handle0xC5(data);
                        break;
                    default:
                        console.log('Unknown packet type');
                        console.log(data);
                }
            }
        });

        // Queue first command to "warm-up" the connection and command queue
        this.query();
    }

    /**
    * Close open connection and cleanup.
    */
    close() {
        if (this._state.closed) {
            console.log('Sensor connection is already closed.');
            return;
        }

        this._port.close();
        this._state.closed = true;
        this._commandQueue.length = 0;
        this.removeAllListeners();
    }

    //#region Sensor methods

    /**
    * Query sensor for it's latest reading. 
    *
    * @returns {Promise<object>} Resolved with PM2.5 and PM10 readings. May be rejected if sensor fails to respond after a number of internal retries.
    */
    query() {
        return this._enqueueQueryCommand(this._port, this._state);
    }
    _enqueueQueryCommand(port, state) {
        function prepare() {
            this.state.pm2p5 = undefined;
            this.state.pm10 = undefined;
        }

        const prepareContext = {
            state: state
        };

        function execute() {
            var command = [
                0xAA, 0xB4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xFF, 0xFF, 0, 0xAB
            ];

            addChecksumToCommandArray(command);
            this.port.write(Buffer.from(command));
        }

        const executeContext = {
            port: port
        };

        function isFullfilled() {
            return (this.state.pm2p5 !== undefined) && (this.state.pm10 !== undefined);
        }
        const isFullfilledContext = {
            state: state
        };

        return new Promise((resolve, reject, onCancel) => {
            function resolveWithReadings() {
                resolve({
                    'PM2.5': this.state.pm2p5,
                    'PM10': this.state.pm10
                });
            }

            const resolveContext = {
                state: state
            };

            const command = new SensorCommand(port, resolveWithReadings.bind(resolveContext), reject, prepare.bind(prepareContext), execute.bind(executeContext), isFullfilled.bind(isFullfilledContext))
            this._enqueueCommand(command);
        });
    }

    /**
    * Set reporting mode. This setting is still effective after power off.
    *
    * @param {('active'|'query')} mode - active: data will be emitted as "data" event, query: new data has to requested manually @see query 
    *
    * @returns {Promise} Resolved when mode was set successfully. May be rejected if sensor fails to respond after a number of internal retries.
    */
    setReportingMode(mode) {
        return this._enqueueSetModeCommand(this._port, this._state, mode);
    }
    _enqueueSetModeCommand(port, state, mode) {
        if (mode !== 'active' && mode !== 'query')
            throw new Error('Invalid mode');

        function prepare() {
            this.state.mode = undefined;
        }

        const prepareContext = {
            state: state
        };

        function execute() {
            var command = [
                0xAA, 0xB4, 2, 1, this.mode === 'active' ? 0 : 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xFF, 0xFF, 0, 0xAB
            ];

            addChecksumToCommandArray(command);
            this.port.write(Buffer.from(command));
        }

        const executeContext = {
            port: port,
            mode: mode
        };

        function isFullfilled() {
            return this.state.mode === this.setMode;
        }
        const isFullfilledContext = {
            state: this._state,
            setMode: mode
        };

        return new Promise((resolve, reject, onCancel) => {
            const command = new SensorCommand(port, resolve, reject, prepare.bind(prepareContext), execute.bind(executeContext), isFullfilled.bind(isFullfilledContext))
            this._enqueueCommand(command);
        });
    }

    /**
    * Get reporting mode.
    *
    * @returns {Promise} Resolved with either 'active' or 'query'. May be rejected if sensor fails to respond after a number of internal retries.
    */
    getReportingMode() {
        return this._enqueueGetModeCommand(this._port, this._state);
    }
    _enqueueGetModeCommand(port, state) {
        function prepare() {
            this.state.mode = undefined;
        }

        const prepareContext = {
            state: state
        };

        function execute() {
            var command = [
                0xAA, 0xB4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xFF, 0xFF, 0, 0xAB
            ];

            addChecksumToCommandArray(command);
            this.port.write(Buffer.from(command));
        }

        const executeContext = {
            port: port
        };

        function isFullfilled() {
            return this.state.mode != undefined;
        }
        const isFullfilledContext = {
            state: this._state
        };

        return new Promise((resolve, reject, onCancel) => {
            function resolveWithMode() {
                resolve(this.state.mode);
            }

            const resolveContext = {
                state: state
            };

            const command = new SensorCommand(port, resolveWithMode.bind(resolveContext), reject, prepare.bind(prepareContext), execute.bind(executeContext), isFullfilled.bind(isFullfilledContext))
            this._enqueueCommand(command);
        });
    }

    /**
    * Switch to sleep mode and back. Fan and laser will be turned off while in sleep mode. Any command will wake the device.
    *
    * @param {boolean} shouldSleep - whether device should sleep or not
    *
    * @returns {Promise} Resolved when operation completed successfully. May be rejected if sensor fails to respond after a number of internal retries.
    */
    setSleepSetting(shouldSleep) {
        return this._enqueueSetSleepCommand(this._port, this._state, shouldSleep);
    }
    _enqueueSetSleepCommand(port, state, shouldSleep) {
        function prepare() {
            this.state.isSleeping = undefined;
        }

        const prepareContext = {
            state: state
        };

        function execute() {
            var command = [
                0xAA, 0xB4, 6, 1, shouldSleep ? 0 : 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xFF, 0xFF, 0, 0xAB
            ];

            addChecksumToCommandArray(command);
            this.port.write(Buffer.from(command));
        }

        const executeContext = {
            port: port,
            shouldSleep: shouldSleep
        };

        function isFullfilled() {
            return this.state.isSleeping === this.shouldSleep;
        }
        const isFullfilledContext = {
            state: this._state,
            shouldSleep: shouldSleep
        };

        return new Promise((resolve, reject, onCancel) => {
            const command = new SensorCommand(port, resolve, reject, prepare.bind(prepareContext), execute.bind(executeContext), isFullfilled.bind(isFullfilledContext))
            this._enqueueCommand(command);
        });
    }

    /**
    * Read software version. It will be presented in "year-month-day" format.
    *
    * @returns {Promise<string>} - Resolved with sensor firmware version. May be rejected if sensor fails to respond after a number of internal retries.
    */
    getVersion() {
        return this._enqueueGetVersionCommand(this._port, this._state);
    }
    _enqueueGetVersionCommand(port, state) {
        function prepare() {
            this.state.firmware = undefined;
        }

        const prepareContext = {
            state: state
        };

        function execute() {
            var command = [
                0xAA, 0xB4, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xFF, 0xFF, 0, 0xAB
            ];

            addChecksumToCommandArray(command);
            this.port.write(Buffer.from(command));
        }

        const executeContext = {
            port: port
        };

        function isFullfilled() {
            return this.state.firmware !== undefined;
        }
        const isFullfilledContext = {
            state: this._state
        };

        return new Promise((resolve, reject, onCancel) => {
            function resolveWithFirmwareVersion() {
                resolve(this.state.firmware);
            }

            const resolveContext = {
                state: state
            };

            const command = new SensorCommand(port, resolveWithFirmwareVersion.bind(resolveContext), reject, prepare.bind(prepareContext), execute.bind(executeContext), isFullfilled.bind(isFullfilledContext))
            this._enqueueCommand(command);
        });
    }

    /**
    * Set working period of the sensor. This setting is still effective after power off.
    *
    * @param {number} time - Working time (0 - 30 minutes). Sensor will work continuously when set to 0.
    *
    * @returns {Promise} Resolved when period was changed successfully. May be rejected if sensor fails to respond after a number of internal retries. 
    */
    setWorkingPeriod(time) {
        if (time < 0 || time > 30)
            throw new Error('Invalid argument.');

        return this._enqueueSetWorkingPeriodCommand(this._port, this._state, time);
    }
    _enqueueSetWorkingPeriodCommand(port, state, time) {
        function prepare() {
            this.state.workingPeriod = undefined;
        }

        var prepareContext = {
            state: state
        };

        function execute() {
            var command = [
                0xAA, 0xB4, 8, 1, this.time, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xFF, 0xFF, 0, 0xAB
            ];

            addChecksumToCommandArray(command);
            this.port.write(Buffer.from(command)); // Send the command to the sensor
        }

        var executeContext = {
            port: port,
            time: time
        };

        function isFullfilled() {
            return this.state.workingPeriod === this.setPeriod;
        }
        var isFullfilledContext = {
            state: this._state,
            setPeriod: time
        };

        return new Promise((resolve, reject, onCancel) => {
            const command = new SensorCommand(port, resolve, reject, prepare.bind(prepareContext), execute.bind(executeContext), isFullfilled.bind(isFullfilledContext))
            this._enqueueCommand(command);
        });
    }

    /**
    * Get current working period.
    *
    * @returns {Promise<Number>} Resolved with current period setting. May be rejected if sensor fails to respond after a number of internal retries. 
    */
    getWorkingPeriod() {
        return this._enqueueGetWorkingPeriodCommand(this._port, this._state);
    }
    _enqueueGetWorkingPeriodCommand(port, state) {
        function prepare() {
            this.state.workingPeriod = undefined;
        }

        var prepareContext = {
            state: state
        };

        function execute() {
            var command = [
                0xAA, 0xB4, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xFF, 0xFF, 0, 0xAB
            ];

            addChecksumToCommandArray(command);
            this.port.write(Buffer.from(command)); // Send the command to the sensor
        }

        var executeContext = {
            port: port
        };

        function isFullfilled() {
            return this.state.workingPeriod !== undefined;
        }
        var isFullfilledContext = {
            state: this._state
        };

        return new Promise((resolve, reject, onCancel) => {
            function resolveWithTime() {
                resolve(this.state.workingPeriod);
            }

            const resolveContext = {
                state: state
            };

            const command = new SensorCommand(port, resolveWithTime.bind(resolveContext), reject, prepare.bind(prepareContext), execute.bind(executeContext), isFullfilled.bind(isFullfilledContext))
            this._enqueueCommand(command);
        });
    }

    //#endregion

    //#region Command processing queue
    _enqueueCommand(command) {
        if (command.constructor.name !== 'SensorCommand')
            throw new Error('Argument of type "SensorCommand" is required.');

        this._commandQueue.push(command);

        if (!this._isCurrentlyProcessing) {
            this._processCommands();
        }
    }

    _processCommands() {
        this._isCurrentlyProcessing = true;
        const cmd = this._commandQueue[0];

        // Run prepare command for the first execution of new command
        if (this._retryCount == 0 && cmd !== undefined)
            cmd.prepare();

        // Reject command if it failed after defined number of retries
        if (++this._retryCount > ALLOWED_RETRIES) {
            const faultyCommand = this._commandQueue.shift();

            faultyCommand.failureCallback(); // Let the world know
            this._retryCount = 0;

            this._processCommands(); // Move to the next command
            return;
        }

        if (this._commandQueue.length > 0) {
            if (cmd.isFullfilled()) {

                this._commandQueue.shift(); // Fully processed, remove from the queue.
                this._retryCount = 0;

                cmd.successCallback();

                this._processCommands(); // Move to the next command
            } else {
                // Command completion condition was not met. Run command and run check after some time.

                cmd.execute();
                setTimeout(this._processCommands.bind(this), COMMAND_RETRY_INTERVAL);
            }
        } else {
            // Processed all pending commands.
            this._isCurrentlyProcessing = false;
            this._retryCount = 0;
        }
    }

    //#endregion
}

/**
  * Structure used to keep all data and functionality needed to run command and retry it if specified condition was not met.
  * These commands will be sequentially processed  in "_processCommands()" method.
  *
  * @ignore
  */
class SensorCommand {
    constructor(sensor, successCallback, failureCallback, prepare, execute, isFullfilled) {
        this.sensor = sensor;
        this.successCallback = successCallback; // called when command was sent and confirmed - in most cases promise's resolve function
        this.failureCallback = failureCallback; // called when command execution was not confirmed - in most cases promise's reject function
        this.prepare = prepare; // called before running first 'execute()' - most of the time clears existing state
        this.execute = execute; // do the actual work - build binary command and send it to the sensor
        this.isFullfilled = isFullfilled; // if this function returns 'false' the command will be retried - up to ${ALLOWED_RETRIES} times. mostly watches internal state for changes.
    }
}

//#region Utils

/**
  *
  * Check if given buffer is a valid packet of SDS011 sensor
  * 
  * @param {Buffer} packet - data packet
  *
  * @return {bool} - validity of packet
  * @ignore
  */
function verifyPacket(packet) {
    if (packet.length != 10)
        return false;

    if (!verifyHeaderAndTail(packet))
        return false;

    if (!isChecksumValid(packet, 8, 2, 7))
        return false

    return true;
}

function verifyHeaderAndTail(packet) {
    const header = packet.readUIntBE(0, 1);
    const tail = packet.readUIntBE(packet.length - 1, 1);

    return (header == 0xAA) && (tail == 0xAB);
}

function isChecksumValid(packet, checksumByteOffset, dataStartOffset, dataEndOffset) {
    const targetChecksum = packet.readUIntBE(checksumByteOffset, 1);
    let calculatedChecksum = 0;

    for (let i = dataStartOffset; i <= dataEndOffset; i++) {
        calculatedChecksum += packet.readUIntBE(i, 1);
    }

    calculatedChecksum = calculatedChecksum % 256;

    return calculatedChecksum === targetChecksum;
}

function addChecksumToCommandArray(command) {
    let checksum = 0;

    // Calculate checksum for DATA1 - DATA14 range
    for (let i = 2; i <= 16; i++)
        checksum += command[i];

    checksum = checksum % 256;
    command[17] = checksum;
}

//#endregion

module.exports = SDS011Wrapper;