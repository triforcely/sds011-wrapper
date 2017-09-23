const Sensor = require('../wrapper.js');

const sensor = new Sensor("COM5"); // Use your system path of SDS011 sensor.

sensor
    .setReportingMode('active')
    .then(() => {
        console.log("Sensor is now working in active mode.");
        return sensor.setWorkingPeriod(0); // Sensor will send data as soon as new data is available.
    })
    .then(() => {
        console.log("Working period set to 0 minutes.");
        console.log("\nSensor readings:");

        // Since working period was set to 0 and mode was set to active, this event will be emitted as soon as new data is received.
        sensor.on('measure', (data) => {
            console.log(`[${new Date().toISOString()}] ${JSON.stringify(data)}`);
        });
    });