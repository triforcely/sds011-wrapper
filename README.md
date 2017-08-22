SDS011-Wrapper
=========

Air quality measurements made easy with wrapper library for SDS011 UART interface.

Save your time and focus on specific IoT solution instead of serial communication.

[![NPM](https://nodei.co/npm/sds011-wrapper.png)](https://npmjs.org/package/sds011-wrapper)

## Watch out!

Nova Fitness SDS011 laser is designed for 8000 hours of continuous use - this is less than one year. It is recommended to configure [working period](https://github.com/triforcely/sds011-wrapper/wiki/API#SDS011Wrapper+setWorkingPeriod) to extend life span of your solution.

## Synopsis

1. Require the module
```js
const SDS011Wrapper = require("sds011-wrapper");
```
2. Connect to your sensor through serial port
```js
const sensor = new SDS011Wrapper("COM5");
```
3. Configure
```js
Promise
    .all([sensor.setReportingMode('active'), sensor.setWorkingPeriod(10)])
    .then(() => {
        // everything's set
    });
```
4. Do awesome things
```js
sensor.on('measure', (data) => {
    if (data['PM2.5'] > 10) {
        powerAirPurifierOn();
    } else {
        powerAirPurifierOff();
    }
});
```

## Installation

  `npm install sds011-wrapper`

## Usage

- Check the 'examples' folder.
- See the [API docs](https://github.com/triforcely/sds011-wrapper/wiki/API)

