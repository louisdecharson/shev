// MODULES
var express = require('express'),
    path = require('path'),
    bodyParser = require('body-parser'),
    favicon = require('serve-favicon'),
    mongodb = require("mongodb"),
    ical = require('ical-generator'),
    shortid = require('shortid');



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
// ==============


// === MONGO DB  === 
// =================
// Create a database variable outside of the database connection callback to reuse the connection pool in your app.
var db;

// Connect to the database before starting the application server.
var args = process.argv.slice(2);
if (args[0] === 'home'){
    var url = "mongodb://localhost:27017/shev";
} else {
    var url = process.env.MONGODB_URI;
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
    var cal = ical({
        domain: 'shareevent',
        name: 'Share Event calendar'
    });
    var event = cal.createEvent({
        start: new Date(ev.startDate),
        end: new Date(ev.endDate),
        summary: ev.name,
        description: ev.notes,
        location: ev.loc
    });
    if (Array.isArray(ev.alarms)) {
        ev.alarms.forEach(function(item,index){
            event.createAlarm({type: 'display', trigger: item*60});
        });
    } else if (typeof ev.alarms != 'undefined') {
        console.log(ev.alarms);
        event.createAlarm({type: 'display', trigger: alarms*60});
    }
    callback(cal.toString());
};

// ROUTES BELOW
// ============ //
app.get('/',function(req,res){
    res.render('index');
});

app.post('/',function(req,res){
    var newEv = req.body;
    newEv.idEv = shortid.generate();
    db.collection('events').insertOne(newEv, function(err, doc) {
        if (err) {
            handleError(res, err.message, "Failed to create new event.");
        } else {
            res.redirect('/view/'+newEv.idEv);
        }
    });
});

app.get('/view/:id',function(req,res){
    var idEv =  req.params.id;
    db.collection('events').findOne({'idEv': idEv},{'name':1,'loc':1,'startDate':1, 'endDate':1,'notes':1,'alarm':1,'idEv':1}, function(err,doc) {
        if (err) {
            handleError(res,err.message,"Failed to get post");
        } else if (doc !== null) {
            doc.url = "http://sharev.herokuapp.com/ev/" + doc.idEv;
            if (doc.notes === null){doc.notes = "";}
            var startDate = new Date(doc.startDate);
            var endDate = new Date(doc.endDate);
            if (startDate.getDate() === endDate.getDate() && startDate.getFullYear() === endDate.getFullYear() && startDate.getMonth() === endDate.getMonth()) {
                doc.day = startDate.getDate().toString() + '/' + (startDate.getMonth()+1).toString() + '/' + startDate.getFullYear().toString();
                doc.startTime = startDate.getHours().toString() + 'h' + (startDate.getMinutes()<10?'0':'').toString() + startDate.getMinutes().toString();
                doc.endTime = endDate.getHours().toString() + 'h' + (endDate.getMinutes()<10?'0':'').toString() + endDate.getMinutes();
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
