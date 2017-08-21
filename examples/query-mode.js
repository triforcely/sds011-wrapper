const Sensor = require('../wrapper.js');

const sensor = new Sensor("COM5"); // Use your system path of SDS011 sensor.

sensor
    .setReportingMode('query')
    .then(() => {
        console.log("Sensor is now working in query mode.");
        return sensor.setWorkingPeriod(0);
    })
    .then(() => {
        console.log("Working period set to 0 minutes.\n");

        // Request data each second.
        setInterval(() => {

            console.log("Querying...");

            // Data will be received only when requested.
            // Keep in mind that sensor (laser & fan) is still continuously working because working period is set to 0.
            sensor
                .query()
                .then((data) => {
                    console.log(`Received: ` + JSON.stringify(data));
                });

        }, 1000);

    });