var Q = require('q');
var request = require('request');
var _ = require('lodash');
//var json = require('json');

var soap = require('soap');
var parseString = require('xml2js').parseString;

var url = 'https://rs.alarmnet.com/TotalConnectComfort/ws/MobileV2.asmx?WSDL'; // Our WSDL
var debug = require('debug')('node-evohome');

function UserInfo(json) {
    this.userID = json.UserID;
    this.username = json.UserName;
    this.firstname = json.FirstName;
    this.lastname = json.LastName;
    this.latesteulaaccepted = json.LatestEulaAccepted;
    this.language = json.Language;
}

// Private
var sessionCredentials = {};

function Session(username, password, appId, json, wsdl) {
    var j2 = json['soap:Envelope']['soap:Body'][0].AuthenticateUserLoginResponse[0].AuthenticateUserLoginResult[0];
	
	//Client is the WSDL object with all SOAP methods
	this.wsdl = wsdl;
	
	this.sessionId = j2.SessionID[0];
	this.userInfo = new UserInfo(j2.UserInfo[0]);
	
	sessionCredentials[this.sessionId] = {
		username: username,
		password: password,
		appId: appId
	};
}

function Location(json) {
	debug('Creating location: %j', json);
	var j2 = json['soap:Envelope']['soap:Body'][0].GetLocationsResponse[0].GetLocationsResult[0];
	var locations = j2.Locations[0].LocationInfo[0];
	
	this.locationID = locations.LocationID[0];

	this.devices = _.map(locations.Thermostats[0].ThermostatInfo, function(device) { return new Device(device); });
	this.timeZone = locations.TimeZone[0];
	debug('Done creating location: %j', this);
}

function Device(json) {
	this.thermostatId = json.ThermostatID[0];
	this.name = json.DeviceName[0];
	this.equipmentStatus = json.EquipmentStatus[0];
	this.thermostat = new Thermostat(json.UI[0]);
	this.fan = new Fan(json.Fan[0]);
}

function Thermostat(json) {
	this.units = json.DisplayedUnits[0];
	this.indoorTemperature = json.DispTemperature[0];
	this.outdoorTemperature = json.OutdoorTemp[0];
	this.deadband = json.Deadband[0];
	
	this.currentHeatSetpoint = json.HeatSetpoint[0];
	this.currentCoolSetpoint = json.CoolSetpoint[0];
	this.schedHeatSetpoint = json.SchedHeatSp[0];
	this.schedCoolSetpoint = json.SchedCoolSp[0];
	
	this.minHeatSetpoint = json.HeatLowerSetptLimit[0];
	this.maxHeatSetpoint = json.HeatUpperSetptLimit[0];
	this.minCoolSetpoint = json.CoolLowerSetptLimit[0];
	this.maxCoolSetpoint = json.CoolUpperSetptLimit[0];
	
	this.canSetSwitchAuto = json.CanSetSwitchAuto[0];
	this.canSetSwitchCool = json.CanSetSwitchCool[0];
	this.canSetSwitchOff = json.CanSetSwitchOff[0];
	this.canSetSwitchHeat = json.CanSetSwitchHeat[0];

	this.outdoorHumidity = json.OutdoorHumidity[0];
	this.indoorHumidity = json.IndoorHumidity[0];

	this.systemSwitchPosition = json.SystemSwitchPosition[0];
}

function Fan(json) {
	this.position = json.Position[0];
	this.canSetAuto = json.CanSetAuto[0];
	this.canSetCirculate = json.CanSetCirculate[0];
	this.canSetOn = json.CanSetOn[0];
	this.isFanRunning = json.IsFanRunning[0];
}

Session.prototype.getLocations = function() {
	var deferred = Q.defer();
	
	// The Client now has all the methods of the WSDL. Use it to create a new order by feeding it the JSON Payload
	var locationsParams =   {
	    "sessionID": this.sessionId
	};
	
	var GetLocations = Q.denodeify(this.wsdl.GetLocations);
	
	GetLocations(locationsParams).then(function(body) {
		parseString(body[1], function(err, result){
		     if(err === null || err === '') {
 				var loc =  new Location(result);
	     		deferred.resolve(loc);
		     } else {
 		     	console.log(err);
		     	deferred.reject(err);
		     }
		});
	});
	
	return deferred.promise;
};

Session.prototype._renew = function() {
	var self = this;
	var credentials = sessionCredentials[this.sessionID];
	var myWsdl = this.wsdl;
	return login(credentials.username, credentials.password, credentials.appId, myWsdl).then(function(json) {
    	var j2 = json['soap:Envelope']['soap:Body'][0].AuthenticateUserLoginResponse[0].AuthenticateUserLoginResult[0];
	
		this.sessionId = j2.SessionID[0];
		this.userInfo = new UserInfo(j2.UserInfo[0]);
	
		return self;
	});
};

function login(username, password, appId, wsdl) {
	var deferred = Q.defer();
	
	// The Client now has all the methods of the WSDL. Use it to create a new order by feeding it the JSON Payload
	var loginParams =   {
	    "username": username,
	    "password": password,	
	    "applicationID": appId,
	    "applicationVersion": 2,
	    "uiLanguage": "English"
	};
	
	var AuthenticateUserLogin = Q.denodeify(wsdl.AuthenticateUserLogin);
	
	AuthenticateUserLogin(loginParams).then(function(body) {
		parseString(body[1], function(err, result){
		     if(err === null || err === '') {
		     	deferred.resolve(result);
		     } else {
 		     	console.log(err);
		     	deferred.reject(err);
		     }
		});
	});
	
	return deferred.promise;
}

function loadWSDL(username, password, appId) {
	var deferred = Q.defer();
	
	// Give the createClient Method the WSDL as the first argument   
	soap.createClient(url, function(err, client){
	     if(client === null || client === '') {
	     	console.log(err);
	     	deferred.reject(err);
	     } else {
	     	deferred.resolve(client);
	     }
	});
	return deferred.promise;
}

module.exports = {
	login: function(username, password, appId) {
		return loadWSDL(username, password, appId).then(function(wsdl) {
			return login(username, password, appId, wsdl).then(function(json) {
				return new Session(username, password, appId, json, wsdl);
			});
		});
	}
};
