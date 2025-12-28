/* Converts a name to an integer (Needed to set planet in ) */

const {Serialize} = require('eosjs');
const {TextDecoder, TextEncoder} = require('text-encoding');
const Uint64LE = require("int64-buffer").Uint64LE;

if (process.argv.length < 3){
    console.error("You must supply the integer to convert");
    process.exit(1);
}

const int = new Uint64LE(process.argv[2]);

const sb = new Serialize.SerialBuffer({
            textEncoder: new TextEncoder,
            textDecoder: new TextDecoder
        });

sb.pushArray(int.toArray());

const name = sb.getName();

console.log(`${int} -> ${name + ''}`);
