/**
  * Structure used to keep all data and functionality needed to run command and retry it if specified condition was not met.
  * These commands will be sequentially processed  in "_processCommands()" method.
  *
  * @ignore
  */
module.exports = class SensorCommand {
    constructor(sensor, successCallback, failureCallback, prepare, execute, isFullfilled) {
        this.sensor = sensor;
        this.successCallback = successCallback; // called when command was sent and confirmed - in most cases promise's resolve function
        this.failureCallback = failureCallback; // called when command execution was not confirmed - in most cases promise's reject function
        this.prepare = prepare; // called before running first 'execute()' - most of the time clears existing state
        this.execute = execute; // do the actual work - build binary command and send it to the sensor
        this.isFullfilled = isFullfilled; // if this function returns 'false' the command will be retried - up to ${ALLOWED_RETRIES} times. Mostly watches internal state for changes.
    }
}
