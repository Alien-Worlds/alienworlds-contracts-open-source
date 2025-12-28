
const createHash = require("sha256-uint8array").createHash;

const fromHexString = hexString =>
    new Uint8Array(hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

function modulo(a, b) {
    return a - Math.floor(a/b)*b;
}
function ToUint32(x) {
    return modulo(x, Math.pow(2, 32));
}

class RNGData {
    constructor(seed){
        console.log(`RNG seed : ${seed}`);
        this.array = fromHexString(seed);
        this.pos = 0;
        // console.log(this.array, this.array.length);
    }

    regen(){
        this.array = createHash().update(this.array).digest();
        this.pos = 0;
    }

    get_uint(len){
        let num = 0;
        if (len + this.pos > this.array.length){
            this.regen();
        }

        for (let i = 0; i < len; i++){
            const b = this.array[this.pos];
            this.pos++;
            num += b << (i * 8);
        }

        return ToUint32(num);
    }

    get_uint8(){
        const required = 1;
        return this.get_uint(required);
    }

    get_uint16(){
        const required = 2;
        return this.get_uint(required);
    }

    get_uint32(){
        const required = 4;
        return this.get_uint(required);
    }
}

module.exports = RNGData;
