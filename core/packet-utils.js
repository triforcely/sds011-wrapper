/**
  *
  * Calculates and updates checksum for outgoing packet.
  * 
  * @param {Array<Number>|Buffer} command - array containing command packet
  * @ignore
  */
  module.exports.addChecksumToCommandArray = function addChecksumToCommandArray(command) {
    let checksum = 0;

    // Calculate checksum for DATA1 - DATA14 range
    for (let i = 2; i <= 16; i++)
        checksum += command[i];

    checksum = checksum % 256;
    command[17] = checksum;
}

/**
  *
  * Check if given buffer is a valid packet of SDS011 sensor
  * 
  * @param {Buffer} packet - data packet
  *
  * @return {bool} - validity of packet
  * @ignore
  */
module.exports.verifyPacket = function (packet) {
    if (packet.length != 10)
        return false;

    if (!verifyHeaderAndTail(packet))
        return false;

    if (!isChecksumValid(packet, 8, 2, 7))
        return false

    return true;
}

/**
  *
  * Check if given packet begins with correct header and ends with correct tail.
  * 
  * @param {Buffer} packet 
  * @ignore
  */
function verifyHeaderAndTail(packet) {
    const header = packet.readUIntBE(0, 1);
    const tail = packet.readUIntBE(packet.length - 1, 1);

    return (header == 0xAA) && (tail == 0xAB);
}

/**
  *
  * Validates checksum in the incoming packet.
  * 
  * @param {Buffer} packet 
  * @param {int} checksumByteOffset - index of checksum
  * @param {int} dataStartOffset - index where data section begins in the packet
  * @param {int} dataEndOffset - index where data section ends in the packet
  * @ignore
  */
function isChecksumValid(packet, checksumByteOffset, dataStartOffset, dataEndOffset) {
    const targetChecksum = packet.readUIntBE(checksumByteOffset, 1);
    let calculatedChecksum = 0;

    for (let i = dataStartOffset; i <= dataEndOffset; i++) {
        calculatedChecksum += packet.readUIntBE(i, 1);
    }

    calculatedChecksum = calculatedChecksum % 256;

    return calculatedChecksum === targetChecksum;
}