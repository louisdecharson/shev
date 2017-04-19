// MODULES
var express = require('express'),
    path = require('path'),
    bodyParser = require('body-parser'),
    favicon = require('serve-favicon'),
    mongodb = require("mongodb"),
    ical = require('ical-generator'),
    shortid = require('shortid'),
    MapboxClient = require('mapbox'),
    https = require('https'),
    moment = require('moment-timezone');

require('dotenv').config({path:path.join(__dirname,'/.env')});

var app = express();
const port = process.env.PORT || 8080; 
        
// === CONFIG === 
// ==============
// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(bodyParser.json({limit: '50mb'}));
app.use(bodyParser.urlencoded({limit: '50mb', extended: true}));
app.use('/',express.static(__dirname + '/public/'));
app.use(favicon(path.join(__dirname,'/public/img/','favicon.ico')));

// ==============


// === MONGO DB  === 
// =================
// Create a database variable outside of the database connection callback to reuse the connection pool in your app.
var db;

// Connect to the database before starting the application server.
var args = process.argv.slice(2);
if (args[0] === 'home'){
    var url = "mongodb://localhost:27017/shev";
    var myDomain = "http://localhost:8080";
} else {
    var url = process.env.MONGODB_URI;
    var myDomain = "http://sharev.herokuapp.com";
}
//
mongodb.MongoClient.connect(url, function (err, database) {
  if (err) {
    console.log(err);
    process.exit(1);
  }
  // Save database object from the callback for reuse.
  db = database;
  console.log("Database connection ready");

  // Initialize the app.
  var server = app.listen(port, function () {
    var port = server.address().port;
    console.log("App now running on port", port);
  });
});
// =================


// HANDLING ERROR
function handleError(res, reason, message, code) {
  console.log("ERROR: " + reason);
    res.status(code || 500).render('error',{error: message});
}


function buildCal(ev,callback) {
    if (Array.isArray(ev.alarm)) {
        var alarms = [];
        ev.alarm.forEach(function(item,index){
            if (item === 'none'){
                if (item*1 !== 0) {
                    var alarm = {type: 'display',trigger: item*60};
                } else {
                    var alarm = {type: 'display',trigger: 1};
                }
                alarms.push(alarm);
            }
        });
    } else if (typeof ev.alarm !== 'undefined' && ev.alarm !== 'none') {
        if (ev.alarm*1 !== 0) {
            var alarms = [{type: 'display', trigger: ev.alarm*60}];
        } else {
            var alarms = [{type: 'display', trigger: 1}];
        }
    } else {
        var alarms = [];
    }
    var cal = ical({
        domain: 'shareevent',
        name: 'Share Event calendar',
        events: [
            {
                start: new Date(ev.startDate),
                end: new Date(ev.endDate),
                summary: ev.name,
                description: ev.notes,
                location: ev.loc,
                alarms: alarms,
                url: myDomain + '/view/'+ev.idEv
            }
        ]
    }).toString();
    callback(cal);
};

function getTimezone(newEv,callback) {
    if (newEv.loc !== undefined && newEv.loc.trim() !== "") {
        var mapboxClient = new MapboxClient(process.env.MAPBOX_ACCESSTOKEN);
        var options = {query: newEv.loc,limit: 1};
        mapboxClient.geocodeForward(newEv.loc, options, function(err, response) {
            var lng = response.features[0].geometry.coordinates[0],
                lat = response.features[0].geometry.coordinates[1];
            var myPath = '/maps/api/timezone/json?location='+ lat + ',' + lng + '&timestamp=1331161200&key=' + process.env.GMAP_APIKEY;
            var options = {
                hostname: 'maps.googleapis.com',
                port: 443,
                path: myPath,
                headers: {'connection': 'keep-alive'}
            };
            https.get(options, function(result) {
                if (result.statusCode >=200 && result.statusCode < 400) {
                    var json = '';
                    result.on('data', function(chunk) {
                        json += chunk;
                    });
                    result.on('end',function() {
                        var timezone = JSON.parse(json)['timeZoneId'];
                        callback(timezone);
                    });
                } else {
                    console.log('Error when retreiving GMaps timezone',result.statusCode, result.statusMessage);
                    callback('');
                }});
        });
    } else {
        callback('');
    }
}

// ROUTES BELOW
// ============ //
app.get('/',function(req,res){
    res.render('index');
});

app.post('/',function(req,res){
    var newEv = req.body;
    newEv.idEv = shortid.generate();
    getTimezone(newEv,function(timezone) {
        if (timezone !== '') {
            newEv.timezone = timezone;
            newEv.userDate = newEv.startDate;
            // var startDate = moment.tz(newEv.startDate,"MM/DD/YYYY h:mm A",timezone).format();
            // var endDate = moment.tz(newEv.endDate,"MM/DD/YYYY h:mm A",timezone).format();
            newEv.startDate = moment.tz(newEv.startDate,"MM/DD/YYYY h:mm A",timezone).format();;
            newEv.endDate = moment.tz(newEv.endDate,"MM/DD/YYYY h:mm A",timezone).format();;
        } else {
            newEv.timezone = 'GMT';
            newEv.userDate = newEv.startDate;
            newEv.startDate = moment.tz(newEv.startDate,"MM/DD/YYYY h:mm A",'GMT').format();
            newEv.endDate = moment.tz(newEv.endDate,"MM/DD/YYYY h:mm A",'GMT').format();
            newEv.notes = newEv.notes + ' Warning, time is set by default at GMT.';
        }
        db.collection('events').insertOne(newEv, function(err, doc) {
            if (err) {
                handleError(res, err.message, "Failed to create new event.");
            } else {
                res.redirect('/view/'+newEv.idEv);
            }
        });
    });
});

app.get('/view/:id',function(req,res){
    var idEv =  req.params.id;
    db.collection('events').findOne({'idEv': idEv},{'name':1,'loc':1,'startDate':1, 'endDate':1,'notes':1,'alarm':1,'idEv':1, 'timezone':1}, function(err,doc) {
        if (err) {
            handleError(res,err.message,"Failed to get post");
        } else if (doc !== null) {
            doc.url = "http://sharev.herokuapp.com/ev/" + doc.idEv;
            if (doc.notes === null){doc.notes = "";}
            var startDate = moment.tz(doc.startDate,doc.timezone);
            var endDate = moment.tz(doc.endDate,doc.timezone);
            if (startDate.date() === endDate.date() && startDate.year() === endDate.year() && startDate.month() === endDate.month()) {
                doc.day = startDate.format('D') + '/' + startDate.format('M') + '/' + startDate.format('YYYY');
                doc.startTime = startDate.format('hh') + 'h' + startDate.format('mm') + ' ' + startDate.format('A');
                doc.endTime = endDate.format('hh') + 'h' + endDate.format('mm') + ' ' + endDate.format('A') + ' (GMT' + endDate.format('Z') + ')' ;
            } else {
                doc.startTime = startDate.format('D') + '/' + startDate.format('M') + '/' + startDate.format('YYYY') + ' at ' + startDate.format('hh') + 'h' + startDate.format('mm') + ' ' + startDate.format('A');
                 doc.endTime = endDate.format('D') + '/' + endDate.format('M') + '/' + endDate.format('YYYY') + ' at ' + endDate.format('hh') + 'h' + endDate.format('mm') + ' ' + endDate.format('A') + ' (GMT' + endDate.format('Z') + ')' ;
            }
            res.render('view_ev',{ev:doc});
        } else {
            handleError(res,"Failed to get event","Failed to get event");
        }
    }); 
});

app.get('/ev/:id',function(req,res){
    var idEv =  req.params.id;
    db.collection('events').findOne({'idEv': idEv},{'name':1,'loc':1,'startDate':1, 'endDate':1,'notes':1,'alarm':1,'idEv':1}, function(err,doc) {
        if (err) {
            handleError(res,err.message,"Failed to get post");
        } else if (doc !== null) {
            if (doc.notes === null){doc.notes = "";}
            res.setHeader("Content-Type", 'text/calendar');
            buildCal(doc,function(cal) {
                res.send(cal);
            });
        } else {
            handleError(res,"Failed to get event","Failed to get event");
        }
    }); 
});


// Very dangerous
process.on('uncaughtException', (err) => {
     console.log(`Caught exception: ${err}`);
});
