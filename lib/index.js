'use strict';

const Redis = require('ioredis'),
    debug = require('debug')('redis-stats');


let internals = {};

const prefix = 'status:';
const cleanupInterval = 300;

class RedisStats {
    constructor(options) {
        // required
        if (!options.servers) {
            throw new Error('RedisStats constructor requires "servers" parameter in options to start. Format: [{host: host, port:port}] ');    
        }
        if (!options.stats) {
            throw new Error('RedisStats constructor requires "stats" parameter in options to start. e.g. [\'used_memory\', \'uptime_in_seconds\'] ');    
        }
        this.servers = options.servers;
        this.redisOptions = options.redisOptions || {};
        this.stats = options.stats;

        // if prefix is set, use it here (otherwise go with default)
        this.prefix = options.prefix || prefix;
        
        // if cluster option is set, use it here, otherwise default is false
        this.cluster = options.cluster || false;

        // optional
        this.interval = options.interval || 60; // default is 60s
        this.maxItems = options.maxItems || 1440; // default is 1 day of timings (assuming 60s interval)

        // the set of servers to be monitored
        this.redises = [];        
        this.servers.forEach((server) => {
            let redisOptions = JSON.parse(JSON.stringify(this.redisOptions));
            redisOptions.host = server.host;
            redisOptions.port = server.port;

            this.redises.push(new Redis(redisOptions));
        });

        // if cluster param was passed in, we use this for writing status back
        if (this.cluster) {
            this.cluster = new Redis.Cluster(this.servers, 
            {
                redisOptions: this.redisOptions
            });
        }

    }

    initialize() {
        // insert data every specified number of seconds
        setInterval(() => {
            this._updateStatus();
        }, this.interval * 1000);

        // cleanup every 5 minutes
        setInterval(() => {
            this._cleanupStatus();
        }, cleanupInterval * 1000);
    }

    _cleanupStatus() {
        this.redises.forEach((redis) => {
            this.stats.forEach((statusItem) => {
                // e.g. "status:127.0.0.1:6379:used_memory"
                let setKey = this.prefix + redis.options.host + ':' + redis.options.port + ':' + statusItem;

                let exec = (redisSrv) => {
                    redisSrv.zcard(setKey, (err, count) => {  
                        if (err) return debug(err);
                        debug('number of items in set ' + setKey + ' is ' + count);
                        if (count > this.maxItems) {
                            debug('Removing ' + (count - this.maxItems) + ' items');
                            redisSrv.zremrangebyrank(setKey, 0, count - this.maxItems - 1, (err, result) => {
                                if (err) return debug(err);
                                debug('Removed ' + result + ' items');                                
                            });
                        }
                    });                                                                        
                }                

                if (this.cluster) {
                    exec(this.cluster); 
                }
                else {
                    exec(redis);
                }
            }); 
        });

    }

    _updateStatus() {
        this.redises.forEach((redis) => {
            redis.info((err, result) => {
                // future emit an event
                if (err) debug(err);

                // e.g. ['used_memory','100mb']
                let status = internals.renderStatus(result);

                status.forEach((statusItem) => {
                    if (this.stats.indexOf(statusItem[0]) > -1) {
                        // statusItem[0] will be the item (e.g. used_memory)
                        // statusItem[1] will be the value (e.g. 100mb)

                        // e.g. "status:127.0.0.1:6379:used_memory"
                        let setKey = this.prefix + redis.options.host + ':' + redis.options.port + ':' + [statusItem[0]] ;
                        
                        let time = new Date();                        
                        let obj = {};
                        obj[time.toISOString()] = statusItem[1];

                        // e.g.  "status:127.0.0.1:6379:used_memory", "now (in ms)", "{'now (in ISO)':'100mb'}'"
                        if (this.cluster) {
                            this.cluster.zadd(setKey, time.getTime(), JSON.stringify(obj));
                        }
                        else {
                            redis.zadd(setKey, time.getTime(), JSON.stringify(obj));                            
                        }

                        debug('added object ' + JSON.stringify(obj) + ' to set ' + setKey);
                    }
                });
            }); 
        });    
    }

}


internals.renderStatus= function(status){
    let lines = status.split('\n');
    let table = [];
    lines.forEach((line) => {
        if (line) {
            let pair = line.split(':');
            let obj = [];
            obj.push(pair[0]);
            obj.push(pair[1] ? pair[1].replace('\r','') : null);
            table.push(obj);
        }
    });
    
    return table;
}

module.exports = RedisStats;