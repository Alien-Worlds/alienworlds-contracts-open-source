const StateReceiver = require('@eosdacio/eosio-statereceiver');
const { Api, JsonRpc, Serialize } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');
const Int64 = require('int64-buffer').Int64BE;
const fetch = require('node-fetch');

const mining_account = 'm.federation';
const setparam_perm = 'setparam';

const config = require('./config');
// Private key: 5HwYVPPnaFoajixE7Yve8izS6HELoCMhqucvf4UhCgr7xiLzqJv
// Public key: EOS7JUT21YpUHbgiEgpBQuCXGmzsmsWupuPWQV25kKxUyWywgLBHd
const private_data = {
    pk: '5HwYVPPnaFoajixE7Yve8izS6HELoCMhqucvf4UhCgr7xiLzqJv'
}

const rpc = new JsonRpc(config.eos.endpoint, { fetch });
const signatureProvider = new JsSignatureProvider([private_data.pk]);
const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });

const whitelist = [
    'atomicdropsx', 'alcordexmain', 'alcordexfund', 'federation', 'm.federation', 's.federation', 'wax.stash', 'earnbetaccts', 'atomicassets', 'atomicpacksx', 'playgambling',
    'qepqy.wam', 'atomicmarket', 'eosio.stake', 'other.worlds', 'upliftreward', 'swap.tycoon', 'wxpjevuzwo35', 'tipcc1111111', 'aw.krown',
    'eosio.ramfee', 'eosio.ram', 'eosio.names', 'a.rplanet', 'market.place', 'simplemarket', 'kcstothemoon', 'kucoinisbest', 'upbitswaxusr', 'upbitswaxhot',
    'kucoinisrich', 'huobiwaxdepo', 'waxbetcrash1', 'waxbetbank11', 'bittrex', 's.rplanet', 'terra.worlds', 'coinkitroota', 'waxlocallyio',
    'r5rqw.wam', 'sxhay.wam', 'povqy.wam', 'qyrau.wam', 'fydr.wam', 'mcdb2.wam', 'w3hqi.wam', 'alcorammswap', 'limitlesswco', 'hiveenginewx', 'waxplorercom',
    'mhbaw.wam', 'sfer2.wam', 'tl2aw.wam', 'le1qu.wam', 'booqw.wam', 'ul5b2.wam', '4g5qy.wam', 'sammysnake55', 't1dbe.wam', 'rfar.wam', 'f.taco',
    '5aaam.wam', '2doay.wam', 'wjtb.wam', 'cpuextreme11', 'nfttreasury1', 'czfqy.wam', 'sammysnake55', 'snakestake55', 'sammysnake5l', 'iy4qw.wam',
    'vs4b2.wam', 'w55qw.wam', 'kbar.wam', 'i1vr2.wam', 'tugbm.wam', '4g5qy.wam', 'ax2qy.wam', 'rr3qw.wam', 'rwck4.wam',
    'q4k5u.wam', 'id5qw.wam', 'y.wam', 'ud2aw.wam', 'aqnr2.wam', 'ul5b2.wam', 'cqcau.wam', 'k1kaw.wam', 'alienhelpers', 'qlir2.wam',
    'skgaw.wam', 'dgdbi.wam', 'xkzrm.wam', 'jzbb.wam', 'xdfqy.wam', 'infidelmines', 'zhqrg.wam', 'dgdbi.wam', 'b.wam.waa', 'geekminingco',
    'qsqba.wam', 'aonqy.wam', 'jt3aw.wam', 'q4rsg.wam', 'tcys2.wam', 'mzrqu.wam', 'fuuri.wam', 'k3bri.wam', 'oper4.wam', '.glr4.wam',
    'i.rre.wam', 'xvabi.wam', 'urgbg.wam', 'j12be.wam', '.cqra.wam', 'ozcbq.wam', 'qverg.wam', 'gmybs.wam', 'neftyblocksd', '33fb.wam',
    'clashdomedls', 'genesis.wax', 'coinex111111', 'coinex222222', 'acab.wam', 'bhdr2.wam', 'nftstickerco', 'zmlbc.wam', 'skgaw.wam',
    'k1kaw.wam', 'jl3aw.wam', 'id5qw.wam', 'zxcbo.wam', 'jl3aw.wam', 'k1kaw.wam', 'id5qw.wam', '33fb.wam', 'qsqba.wam',
    'stonkrewards', 'obcqu.wam', 'y3zra.wam', 'xxzrm.wam', 'sxyqy.wam', 'pxkb2.wam', 'hweaq.wam', 'iy4qw.wam', 'rr3qw.wam', 'irhaw.wam', 'l2wb4.wam',
    'nrsr.wam', '1vgr4.wam', 'vmfrc.wam', 'pb5b4.wam', 'giyb4.wam', 'qx3ay.wam', 'kn2r.wam', 'vhabi.wam', 'tihba.wam', 'jl3aw.wam', 'y3zra.wam',
    'pyaba.wam', '5xjay.wam', 'sh2ry.wam', '52nr4.wam', 'ej1bq.wam', '313r4.wam', 'p5sr4.wam', '4pdqw.wam', 'ddtr4.wam', '3ahb2,wam',
    'kj2ay.wam', 'a2dr2.wam', '4zwr.waa', 'palb.wam', 'cairc.wam', 'cfmr.wam'
]
const { check_bot } = require('./bot-control')({ api, mining_account, setparam_perm, logging_config: config.logging })
const { set_bot, submit_actions, process_tasks_through_api } = require('./bot-control-cloud-control')()
setInterval(submit_actions, 5000)
setInterval(process_tasks_through_api, 10000)
const { delegatebw } = require('./modules/delegatebw')(config.eos.hyperion_endpoint, rpc, set_bot, check_bot, whitelist)
const { transfertlm } = require('./modules/transfertlm')(config.eos.hyperion_endpoint, set_bot, whitelist)
const { transferwax } = require('./modules/transferwax')(config.eos.hyperion_endpoint, set_bot, whitelist)
const { transferasset } = require('./modules/transferasset')(config.eos.hyperion_endpoint, set_bot, check_bot, whitelist)
const { firstbiller } = require('./modules/firstbiller')(set_bot, check_bot, whitelist)
const { lazyusername } = require('./modules/lazyusername')(set_bot, whitelist)
const { setbag } = require('./modules/setbag')(set_bot, whitelist)
const { agreeterms } = require('./modules/agreeterms')(config.eos.hyperion_endpoint, set_bot, whitelist)


class TraceHandler {
    constructor({ config }) {
        this.config = config;
    }

    async processTrace(block_num, traces, block_timestamp) {
        // console.log(`Process block ${block_num}`)
        for (const trace of traces) {
            switch (trace[0]) {
                case 'transaction_trace_v0':
                    const trx = trace[1];
                    for (let action of trx.action_traces) {
                        // console.log(action)
                        const full_action = `${action[1].act.account}::${action[1].act.name}`
                        switch (full_action) {
                            case 'eosio::delegatebw':
                                {
                                    const delbw_whitelist = ['wam', 'waa', 'eosio.voters', 'boost.wax', 'cpuextreme11']
                                    // console.log('delegate', action[1])
                                    const action_deser = await api.deserializeActions([action[1].act]);
                                    // console.log(action_deser[0]);
                                    if (!delbw_whitelist.includes(action_deser[0].data.from) && !whitelist.includes(action_deser[0].data.from) && action_deser[0].data.from !== action_deser[0].data.receiver && action_deser[0].data.from != 'wam') {
                                        // console.log(`Bandwidth delegated`, action_deser[0])
                                        delegatebw(action_deser[0].data)
                                        // set_bot('a.way.wam', true)
                                    }
                                }
                                break
                            case 'alien.worlds::transfer':
                                {
                                    const action_deser = await api.deserializeActions([action[1].act]);
                                    if (action_deser[0].data.from.substr(-11) !== '.federation' && action[1].receiver === 'alien.worlds') {
                                        transfertlm(action_deser[0].data)
                                    }
                                }
                                break
                            case 'm.federation::mine':
                                {
                                    firstbiller(action[1])
                                }
                                break
                            case 'eosio.token::transfer':
                                {
                                    const action_deser = await api.deserializeActions([action[1].act]);
                                    if (action_deser[0].data.from !== 'eosio' && !whitelist.includes(action_deser[0].data.from) && !whitelist.includes(action_deser[0].data.to)) {
                                        if (action[1].receiver === 'eosio.token') {
                                            //console.log('transfer wax', action_deser[0].data)
                                            transferwax(action_deser[0].data);
                                        }
                                    }
                                }
                                break
                            case 'atomicassets::transfer':
                                {
                                    const action_deser = await api.deserializeActions([action[1].act]);
                                    if (action_deser[0].data.to === 'wcmc4.wam' && !whitelist.includes(action_deser[0].data.from) && !whitelist.includes(action_deser[0].data.to)) {
                                        console.log('transferasset', action[1], action_deser[0].data);
                                        transferasset(action_deser[0].data)
                                    }
                                }
                                break
                            case 'other.worlds::teleport':
                                {
                                    const action_deser = await api.deserializeActions([action[1].act]);
                                    transfertlm({ to: action_deser[0].data.from })
                                }
                                break
                            case 'federation::settag':
                                {
                                    const action_deser = await api.deserializeActions([action[1].act]);
                                    lazyusername(action_deser[0].data)
                                }
                                break
                                /*case 'm.federation::setbag':
                                {
                                    const action_deser = await api.deserializeActions([action[1].act]);
                                    setbag(action_deser[0].data)
                                }
                                    break
                                case 'federation::agreeterms':
                                {
                                    const action_deser = await api.deserializeActions([action[1].act]);
                                    // console.log(block_timestamp.toString())
                                    // agreeterms(action_deser[0].data, block_timestamp)
                                }*/
                                break
                        }
                    }
            }
        }
    }
}


const start = async (start_block) => {

    const trace_handler = new TraceHandler({ config });

    sr = new StateReceiver({
        startBlock: start_block,
        endBlock: 0xffffffff,
        mode: 0,
        config
    });
    sr.registerTraceHandler(trace_handler);
    sr.start();
}

const run = async () => {
    let start_block;
    if (typeof process.argv[2] !== 'undefined') {
        start_block = parseInt(process.argv[2]);
        if (isNaN(start_block)) {
            console.error(`Start block must be a number`);
            process.exit(1);
        }
    }
    else {
        const info = await rpc.get_info();
        start_block = info.head_block_num;
    }
    console.log(`Starting at block ${start_block}`)

    start(start_block);
}

// delegatebw('alienhelpers');
// transfertlm({to: 'iy4qw.wam'});
// transferasset({ to: 'p3cry.wam' });
run();
