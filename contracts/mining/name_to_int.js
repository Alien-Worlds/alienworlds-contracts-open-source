/* Converts a name to an integer (Needed to set planet in ) */

const {Serialize} = require('eosjs');
const {TextDecoder, TextEncoder} = require('text-encoding');
const Int64LE = require("int64-buffer").Int64LE;

if (process.argv.length < 3){
    console.error("You must supply the name to convert");
    process.exit(1);
}

const name = process.argv[2];

const sb = new Serialize.SerialBuffer({
            textEncoder: new TextEncoder,
            textDecoder: new TextDecoder
        });

sb.pushName(name);

const name_64 = new Int64LE(sb.array);

console.log(`${name} -> ${name_64 + ''}`);
