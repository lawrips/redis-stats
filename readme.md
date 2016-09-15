# redis-stats
Automatic generation of stats using the redis INFO command

```javascript
var RedisStats = require('redis-stats');

var redisStats = new RedisStats({
    servers: [{'host': 'localhost', 'port': 6379}],
    stats: ['uptime_in_seconds','used_memory'],
});

redisStats.initialize();
```

## How it works
Include and initialize this library to automatically take snapshots of your redis server(s) using the rediS INFO command. By having these stats automatically generated in the background, it becomes easy to create graphs on memory usage, # connected clients, uptime, changes since last backup, etc. 

The INFO stats are persisted in the same Redis instance(s) as those being monitored. 

## Usage
To initialize Redis-Stats, use the minimum setup:

```javascript
var RedisStats = require('redis-stats');

var redisStats = new RedisStats({
    servers: [{'host': 'localhost', 'port': 6379}],
    stats: ['uptime_in_seconds','used_memory'],
});

redisStats.initialize();
```

### Output
As stats are collected, they are stored back in Redis in a ZSET. Each server + statistic combo will form its own zset. The full format is:

```
<prefix>:<server>:<port>:<statistic>
```

For example:

```
status:127.0.0.1:6379:used_memory 
```

Within each zset, the entries are ranked by time inserted (i.e. new Date().getTime()) in descending order and take the format:

```
{'<date_in_iso_format>':'<value_of_statistic'>}
```

For example:

```
{"2016-09-15T20:24:46.050Z":"233"}
``` 

### Displaying Stats
You can consume this data yourself pretty easily by just doing something like:

```javascript
redis.zrangebyscore('status:' + host + ':' + port + ':' + type, '-inf', '+inf', (err, results) => {
    console.log('all my stats:' + results);
});                
```

Alternatively, I'm writing a separate reactjs library which will turn these stats into charts (using the lovely chartjs).

[Find out more at Redis-Live](https://www.npmjs.com/package/redis-live). 

### Options
The full list of options accepted by the Redis-Stats constructor:

```js
{
    servers: [{'host':'host', 'port':'port'}],  // array of servers to be monitored   
    stats: ['uptime_in_seconds','used_memory'],   // list of stats to monitor - full list is here http://redis.io/commands/INFO
    redisOptions : {},  // (optional) standard redis options (e.g. 'password')
    prefix: 'myserverstats:',    // (optional) prefix to insert in front of keys in redis for any persisted stats 
    cluster: true,      // (optional) if true, the supplied redis servers will be treated as a cluster. If false (default), they'll be treated as independent servers      
    interval: 30,  // (optional) how long in seconds to wait between each redis INFO command (default is 60)
    maxItems:  5400     // (optional) how many items to persist for each server:stat combo (default is 1440 which is 1 days worth of stats at 1 minute intervals)
}
```


### Debugging

To see debug logs as they are generated, simply set the environment variable:

```
DEBUG=redis-stats
``` 

### Next steps
A bunch of todos:

1. Tests!
2. More time slicing options (e.g. bucketing by hour, etc) 
3. Event emitting for errors (e.g. connection failed to redis, etc)
4. More display options (which will be in other libraries like redis-live)
