var fs = require('fs');
var monitor = require('os-monitor');
var exec = require('child_process').exec
var express = require('express');
var bodyParser = require('body-parser');
var Twilio = require('./node_modules/twilio/lib');

// read .env file and get twilio credentials
require('dotenv').config()

// get hostname
var hostname = monitor.os.hostname();


// Read the configuration in from a file.
var config = JSON.parse(fs.readFileSync('phonetopconfig.json', 'utf8'));

// variables to make sure we don't send too many messages
var messagesSent = 0;
var maxMessages = config.twilio.maxmessages;

// Twilio configuration (using environment variables)
var accountSid = process.env.TWILIO_ACCOUNT_SID;
var token = process.env.TWILIO_AUTH_TOKEN;
var twilio = new Twilio(accountSid, token);
var tonumber = config.twilio.tonumber;
var fromnumber = config.twilio.fromnumber;

// ---------------------------------------------------------------------------
// --------------------------- MONITOR SECTION -------------------------------
// ---------------------------------------------------------------------------
// Configure the monitor.
var event_keys = Object.keys(config.events);
var monitor_config = {};
event_keys.map(function(event_key) {
	monitor_config[event_key] = config.events[event_key].value
});
monitor_config['delay'] = config.misc.delay;

// Start the monitor
monitor.start(monitor_config);

// Function for sending SMS via twilio.
var send_sms = function(message) {
    if(messagesSent < maxMessages) {
		twilio.messages.create({
			from: fromnumber,
			to: tonumber,
			body: hostname + ": " + message
		}, function(err, result) {
			if(err){
				console.log("ERROR: " + JSON.stringify(err));
			} else {
				console.log('Created message using callback');
				console.log(result.sid);
			}
	});
	messagesSent++;
    }

}

// Handler for event loadavg1
monitor.on('loadavg1', function(event) {
    console.log(event.type, ' Load average is exceptionally high!!!');
    send_sms(config.events.critical1.message);
});

// Handler for event loadavg5
monitor.on('loadavg5', function(event) {
    console.log(event.type, ' Load average is exceptionally high!!!');
    send_sms(config.events.critical5.message);
});

// Handler for event loadavg15
monitor.on('loadavg15', function(event) {
    console.log(event.type, ' Load average is exceptionally high!!!');
    send_sms(config.events.critical15.message);
});

// Handler for event freemem
monitor.on('freemem', function(event) {
    console.log(event.type, ' Free memory is very low.');
    send_sms(config.events.freemem.message);
});

// Handler for event uptime
monitor.on('uptime', function(event) {
    console.log(event.type, ' Uptime exeeded threshold.');
    send_sms(config.events.uptime.message);
});

// ---------------------------------------------------------------------------
// ----------------------- UTILITY FUNCTION SECTION --------------------------
// ---------------------------------------------------------------------------
var twiMsg = function(msg, res) {
	var twistr = '<?xml version="1.0" encoding="UTF-8"?><Response><Message>' + msg + '</Message></Response>';
	res.send(twistr);
};


// ---------------------------------------------------------------------------
// ---------------------------- HANDLER SECTION ------------------------------
// ---------------------------------------------------------------------------
var cmdHandlers = {
	"cpustatus": {
		handler: function(res) {
			var numCPUs = monitor.os.cpus().length;
			var loadaverages = monitor.os.loadavg();
			var loadaverage_1 = ((loadaverages[0] / numCPUs) * 100).toFixed(1);
			var loadaverage_5 = ((loadaverages[1] / numCPUs) * 100).toFixed(1);
			var loadaverage_15 = ((loadaverages[2] / numCPUs) * 100).toFixed(1);

			// Catch bugs with calculations and lower precision for shorter text messages..
			loadaverage_1 = isFinite(loadaverage_1) ? loadaverage_1 : "ERR";
			loadaverage_5 = isFinite(loadaverage_5) ? loadaverage_5 : "ERR";
			loadaverage_15 = isFinite(loadaverage_15) ? loadaverage_15 : "ERR";

			var normalizedLoadAverages = {
				"1": loadaverage_1,
				"5": loadaverage_5,
				"15": loadaverage_15
			};
			var retMessage = 'CPU status report from ' + hostname + ': 1 minute avg - ' + normalizedLoadAverages['1'] + '%, 5 minute avg - ' + normalizedLoadAverages['5'] + '%, 15 minute avg - ' + normalizedLoadAverages['15'] + '%';
			twiMsg(retMessage, res);
		}
	},
	"memstatus": {
		handler: function(res) {
			var freeBytes = monitor.os.freemem();
			var retMessage = 'Memory status report from ' + hostname + ': ' + freeBytes + ' bytes free of memory.';
			twiMsg(retMessage, res);
		}
	},
	"procstatus": {
		handler: function(res) {
			exec.cmd('ps -eo comm,pid,pcpu,pmem', function(error, stdout, stderror) {
				if(error) {
					console.log('ERROR: ' + error);
					twiMsg('Could not get process list. Please contact your system administrator.', res);
				} else {
					twiMsg('Process listing for ' + hostname + ':\n' + stdout, res);
				}
			});
		}
	}
};

// ---------------------------------------------------------------------------
// --------------------------- EXPRESS SECTION -------------------------------
// ---------------------------------------------------------------------------
var app = express();
app.use(bodyParser.urlencoded({extended: false}));

app.post('/cmd', Twilio.webhook(), function(req, res) {
	var smsBody = req.body['Body'];
	var cmd = (smsBody.split(" ")[0]).toLowerCase();
	console.log('DEBUG: ' + cmd + ' is input.');
	if(cmd in cmdHandlers) {
		cmdHandlers[cmd].handler(res);
	} else {
		twiMsg('Command ' + cmd + ' not supported.', res);
	}
});

app.listen(2000, function() {
	console.log('Listening on port 2000...');
});
