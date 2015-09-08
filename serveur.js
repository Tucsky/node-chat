/* Gettin' the server dependencies
*/

var express = require('express'),
	path = require('path'),
	app = express(),
	http = require('http').Server(app),
	extend = require('extend'),
	io = require('socket.io')(http),
	cookieParser = require('socket.io-cookie'),
	fs = require('fs'),
	ss = require('socket.io-stream'),
	retricon = require('retricon'),
	crypto = require('crypto'),
	mongoose = require('mongoose'),
	bcrypt = require('bcrypt'),
	glob = require('glob'),
	config = JSON.parse(fs.readFileSync('config.json', 'UTF-8'));

/* Check app configuration
*/
if (!config || !config.mongouri)
	return console.log('/!\\ missing app configuration, checkout config.json for details');

/* Some boring prefs
*/

var options = {
	port: process.env.ENV_VARIABLE || 3000,
	ip: 'localhost',
	mongouri: config.mongouri,
	http: __dirname+'/http',
	welcome: null,
	help: '<code>/w [nickname] [message]</code> Envois un message privé<br>\
			<code>/nick [nickname]</code> Change le pseudo<br>\
			<code>/ping</code> Affiche le temps de retour serveur<br>\
			<code>/clear</code> Supprime les messages de la chatbox',
	upload: {
		avatar: {ext: ['png', 'jpg', 'gif'], max: 3145728, path: '/avatar'},
		hosting: {max: 41943040, ext: ['png', 'jpg', 'pptx', 'ppt', 'gif', 'txt', 'html', 'css', 'js', 'php', 'java', 'zip', 'rar', 'iso', 'mp4', 'mkv', 'avi', 'mp3', 'psd'], path: ''}
	}
}

/* App memory
*/

var _USERS = [];
var _MESSAGES = [];
var _FILES = {};
var _DB = {
	USERS: mongoose.model('users', {
		id: String,
		nickname: String,
		avatar: String,
	})
};

/* User class
*/

var User = function(o) {
	var user = this, o = o || {};

	// Does it actually exists on this server ?
	if (o.id && getuserbyid(o.id).id && (alreadyexists = getuserbyid(o.id))) {
		console.log(alreadyexists.nickname+'@'+o.id, 'recovering...');

		// Yes it does, but is it online ? If so, then disconnect it to clean up the user slot
		alreadyexists.online && alreadyexists.io && 
			alreadyexists.io.disconnect();

		// Forward the new socket.io client object
		alreadyexists.io = o.io;

		return alreadyexists;
	}

	// No? then create a new one using the given parameters (o)
	user.id = o.id || rand(16);
	user.online = true;
	user.nickname = o.nickname || 'guest_'+user.id.slice(0, 4);
	user.io = o.io;
	user.avatar = null;

	// Mongo
	if (!o._id) {
		console.log(user.nickname+'@'+user.id, 'insert@mongo');
		new _DB.USERS({id: user.id, nickname: user.nickname}).save();
	}

	// Formater (to clean up user object before sending it)
	user.format = function(private) {
		var formated = {
			id: user.id,
			nickname: user.nickname,
			avatar: user.avatar
		};

		return formated;
	}

	// Update user on demand
	user.update = function(data) {
		var data = data || {},
			changes = {};
		
		if (typeof data.nickname !== 'undefined') {
			var nickname = data.nickname.replace(/[^a-zA-Z0-9À-ž _-]/g, '');;
			if (nickname.length > 2)
				user.io.emit('message', {content: 'Vous vous appellez maintenant <span class="text-success">'+nickname+'</span>', type: 'html'}),
				user.io.broadcast.emit('message', {content: '<span class="text-muted">'+user.nickname+'</span> est maintenant <span class="text-success">'+nickname+'</span>', type: 'html'}),
				changes.nickname = nickname;
			else
				user.io.emit('message', {content: 'Le pseudo "'+nickname+'" doit faire au moins 3 caractères', class: 'text-danger'});
		}

		if (typeof data.avatar !== 'undefined') {
			changes.avatar = data.avatar;
		}

		if (changes != {}) {
			_DB.USERS.update({id: user.id}, changes, {upsert: true}, function(err, res) {
				if (err) 
					console.error(user.nickname+'@'+user.id, 'update@mongo failed', changes);
				else
					console.log(user.nickname+'@'+user.id, 'update@mongo success', changes);
			});
		}

		extend(user, changes);

		user.io.broadcast.emit('profile', user.format(), changes);
		user.io.emit('profile', user.format(true), changes);
	}

	// Publish files
	user.publish = function(file) {
		var from = fs.createReadStream(__dirname+'/tmp/'+file.name),
			path = '/static'+options.upload[file.env].path+'/'+(file.env == 'avatar' ? user.id+'.'+file.ext : file.name);
			console.log(user.nickname+'@'+user.id, 'move2public "'+file.name+'"');

		from.pipe(fs.createWriteStream(__dirname+'/public'+path));
		from.on('end', function() {
			fs.unlink(__dirname+'/tmp/'+file.name, function () {
				user.io.emit('complete', {file: {
					id: file.id,
					name: file.name,
					size: file.size,
					path: path
				}});
				if (file.env == 'hosting') {
					var data = {content: '<a href="'+path+'" target="_blank" class="file io-document">'+(file.name.lenght > 50 ? file.name.substr(0,30)+'<i>'+file.name.substr(30,file.name.length-20)+'</i>'+file.name.substr(-20,20) : file.name)+'</a>', type: 'html', author: user.format(), timestamp: +new Date()};

					_MESSAGES.push(data);
					if (_MESSAGES.length > 15) _MESSAGES.shift();		

					io.emit('message', data);				
				} else if (file.env == 'avatar') {
					user.update({avatar: file.id});
				}
			});
		});
		from.on('error', function(err) {
			user.io.emit('complete', {'error': 'Impossible de copier le fichier uploadé'});
		});
	}

	// User commands
	user.cmd = {
		login: function(data) {
			var email = data.email,
				password = data.password;

			var options = {id: user.id};
			if (!email || !password)
				return user.io.emit('dialog', {content: 'Mauvais login / mot de passe', title: 'Erreur', class: 'danger'});

			if (/^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/.test(email))
				options['email'] = email;
			else
				options['nickname'] = email;

			_DB.USERS.findOne(options).exec(function(err, user) {
				if (err) {
					console.error(user.nickname+'@'+user.id, 'login@mongo failed', err);
					user.io.emit('dialog', {content: 'Erreur interne', title: 'Erreur', class: 'danger'});
				} else {
					if (bcrypt.compareSync(password, hash)) {
						console.log(user.nickname+'@'+user.id, 'login@mongo success');

						var token = rand(32);

						_DB.USERS.update({id: user.id}, {remember: token}, {upsert: true}, function(err, res) {
							if (err) {
								console.error(user.nickname+'@'+user.id, 'tokenregister@mongo failed', err);
								user.io.emit('dialog', {content: 'Erreur interne', title: 'Erreur', class: 'danger'});
							} else {
								user.io.emit('login', {token: token});
							}
						});

					} else {
						console.log(user.nickname+'@'+user.id, 'login@mongo failed');
						user.io.emit('dialog', {content: 'Mauvais login / mot de passe', title: 'Erreur', class: 'danger'});
					}
				}
			});
		},

		register: function(data) {
			var email = data.email,
				password = data.password;

			if (!email || !/^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/.test(email))
				return user.io.emit('dialog', {content: 'Email "'+(email || '')+'" non valide', title: 'Erreur', class: 'danger'});
			if (!password || password.length < 3)
				return user.io.emit('dialog', {content: 'Le mot de passe doit faire au minimum 3 caractères', title: 'Erreur', class: 'danger'});

			var bcrypt = require('bcrypt');
			var salt = bcrypt.genSaltSync(10);
			var hash = bcrypt.hashSync(password, salt);

			_DB.USERS.update({id: user.id}, {hash: hash, email: email}, {upsert: true}, function(err, res) {
				if (err) {
					console.error(user.nickname+'@'+user.id, 'register@mongo failed', err);
					user.io.emit('dialog', {content: 'Erreur interne', title: 'Erreur', class: 'danger'});
				} else {
					console.log(user.nickname+'@'+user.id, 'register@mongo success', token);
					user.io.emit('register', {success: true});
				}
			});
		},

		message: function(data) {
			var data = {author: user.format(), content: data, timestamp: +new Date()};

			_MESSAGES.push(data);
			if (_MESSAGES.length > 15) _MESSAGES.shift();

			io.emit('message', data);
		},

		ping: function(data) {
			user.io.emit('pong');
		},

		w: function(data, input) {
			var argument = /([a-zA-Z0-9À-ž-_]*) ([\s\S]*)/.exec(data);
			if (!argument || !argument[1]) return user.io.emit('message', {content: 'Syntaxe "'+input+'" non valide', class: 'text-danger'});

			var target = _USERS.filter(function(e) {
				return e.nickname.toLowerCase().replace(/ /g, '_') == argument[1].toLowerCase().replace(/ /g, '_') && e.online;
			})[0];
			var time = +new Date();

			if (!target) return user.io.emit('message', {content: "<span class='text-muted'>"+argument[1]+"</span> n'est pas connecté", type: 'html', class: 'text-danger'});

			console.log(user.nickname+'@'+user.id, 'mp', argument[1], '"'+argument[2]+'"');
			target.io.emit('message', {content: argument[2], class: 'mp', author: user.format(), target: target.format(), timestamp: time});
			user.io.emit('message', {content: argument[2], class: 'mp', author: user.format(), target: target.format(), timestamp: time});
		},

		help: function() {
			user.io.emit('message', {content: options.help, type: 'html'});
		}
	}

	return _USERS[_USERS.push(user)];
}

// Search user by id through the _USERS "array of objects" using the goddamn "for" loop
function getuserbyid(id) {
	for (var i = 0; i < _USERS.length; i++) {
		if (_USERS[i].id == id) return _USERS[i];
	}
	return {};
}

/* MongoDB
*/

mongoose.connect(options.mongouri);

// When the mongodb server is connected
mongoose.connection.on('connected', function () {
	console.info('server@mongo', 'connected');
});

// If the connection throws an error
mongoose.connection.on('error',function (err) {
	console.error('server@mongo', 'error', err);
});

// When the connection is disconnected
mongoose.connection.on('disconnected', function () {
	console.warn('server@mongo', 'disconnected');
});

/* SocketIO things
*/

// Public namespace
app.use(express.static(path.join(__dirname, 'public')));

// Static root http (the view)
app.get('/', function(req, res){
	res.sendFile('index.html');
});
app.get('/avatar/:id', function(req, res) {
	var id = req.params.id || 'default';
	glob(__dirname+'/public/static/avatar/'+id+'*', function (er, files) {
		if (!files.length) {
			console.log('generating avatar...', id);
			var data = retricon(id, {pixelSize: 8}).toDataURL(),
				matches = data.match(/^data:.+\/(.+);base64,(.*)$/),
				buffer = new Buffer(matches[2], 'base64');

			fs.writeFile(__dirname+'/public/static/avatar/'+id+'.png', buffer, function() {
				res.sendFile(__dirname+'/public/static/avatar/'+id+'.png');
			});
		} else {
			res.sendFile(files[0]);
		}
	});
});

// Start the nodejs web server using the given ip and port 
http.listen(options.port, options.ip, function(){
	console.log('Listening on '+options.ip+':'+options.port);
});

// We will need to parse some cookies using the "cookieParser" package
io.use(cookieParser);

// The pre-connection (authorization) function uniquely identifies the user using the cookie "node" wrote previously in the client-side
io.use(function authorizing(socket, next) {
	socket.node = (socket.request.headers.cookie.node && JSON.parse(socket.request.headers.cookie.node)) || {};
	next();
});

// Lets the magic of event-driven programming begin
io.on('connection', function(socket) {

	// Encypt ID
	if (socket.node && socket.node.id) 
		socket.node.id = encrypt(socket.node.id).substr(0, 16);

	// Lets search on the mongodb class
	_DB.USERS.findOne({id: socket.node.id}).exec(function(err, store) {
		if (err) 
			return console.log(socket.node.id, 'find error "'+err.message+'"');

		store = store || {};

		// Create / recover user object ant turn it online
		var user = new User(extend(socket.node, {io: socket}, store));
			user.online = true;

		/* New user logic
		*/

			// Send 'user join the conversation' packet to everyone except user
			socket.broadcast.emit('join', user.format());
			console.log(user.nickname+'@'+user.id, 'join');

			// Get a safe version of online users
			var table = _USERS.filter(function(e) { 
				return e.online ? true : false;
			}).map(function(e) { 
				return e.format(); 
			});

			// Send initialization packet to user
			socket.emit('init', {user: user.format(true), users: table, messages: _MESSAGES, welcome: options.welcome});

		/* Main events
		*/

		socket.on('input', function(input) {
			var input = input.replace(/^\s+|\s+$/g, '').replace(/\n{2,}/g, "\n\n");
			if (!input.length) return;

			// Server side commands
			if ((command = /^\/([a-z0-9_-]{1,10})\s?([\s\S]*)/.exec(input))) {
				if (typeof user.cmd[command[1]] === 'function') {
					var name = command[1],
						argument = command[2];

					user.cmd[command[1]](argument, input);
				} else {
					socket.emit('message', {content: "<span class='text-muted'>"+command[1]+"</span> n'est pas une commande", type: 'html', class: 'text-danger'});
				}
			} else {
				user.cmd.message(input);
			}
		});

		socket.on('profile', function(data) {
			user.update(data);
			console.log(user.nickname+'@'+user.id, 'update attempt', data);
		});

		socket.on('disconnect', function(){
			console.log(user.nickname+'@'+user.id, 'leave');
			io.emit('leave', {user: user.format()});
			user.online = false;
		});

		/* File upload
		*/

		socket.on('start', function(data) {
			console.log(user.nickname+'@'+user.id, 'upload attempt');
			if (!data.name || !data.name.length || data.name.replace(/[^a-zA-Z\s\d.]/g, '').length < 2) return socket.emit('complete', {'error': 'Nom du fichier invalide'});
			if (!data.env || !options.upload[data.env]) return socket.emit('complete', {'error': 'Environnement non défini'});

			// Validate extensions based on upload environment
			var ext = /(?:\.([^.]+))?$/.exec(data.name)[1];
			if (!ext || options.upload[data.env].ext.indexOf(ext.toLowerCase()) === -1) return socket.emit('complete', {'error': 'Extension "'+(ext || 'inconnue')+'" non autorisée'});

			// File size restriction
			if (data.size > options.upload[data.env].max) return socket.emit('complete', {'error': 'Le fichier est trop lourd (maximum '+options.upload[data.env].max.fileSize(1)+')'});

			var file = _FILES[data.id] = {
				id: data.id,
				size: data.size,
				name: user.id+'_'+data.name.replace(/[^a-zA-Z\s\d.]/g, ''),
				downloaded: 0,
				data: '',
				handler: null,
				env: data.env,
				ext: ext
			}

			var buffer = 0;

			try {
				var existing = fs.statSync(__dirname+'/tmp/'+file.name);
				if (existing.isFile()) {
					file.downloaded = Stat.size;
					buffer = Stat.size / 524288;
				}
			} catch(err) {}

			fs.open(__dirname+'/tmp/'+file.name, 'a', 0755, function(err, handler) {
				if (err) {
					console.log(err);
				} else {
					file.handler = handler;
					socket.emit('uploading', {'buffer': buffer, percent: 0, bytes: 0});
				}
			});
		});

		socket.on('upload', function(data) {
			if (!_FILES[data.id]) return;

			var file = _FILES[data.id];
				file.downloaded += data.buffer.length;
				file.data += data.buffer;

			console.log(user.nickname+'@'+user.id, 'uploading '+(+(file.downloaded / file.size).toFixed(2) * 100)+'%');

			if (file.downloaded == file.size) {
				fs.write(file.handler, file.data, null, 'Binary', function(err, data) {
					if (file.env == 'avatar')
						glob(__dirname+'/public/static/avatar/'+user.id+'*', function (err, files) {
							var n = files.length;
							console.log(user.nickname+'@'+user.id, 'glob found "'+n+'" result'+(n > 1 ? 's' : ''));
							if (n)
								files.forEach(function(f) {
									console.log(user.nickname+'@'+user.id, 'unlink "'+f+'"');
									fs.unlink(f, function() {
										if (--n <= 0) return user.publish(file);
									});
								});
							else
								user.publish(file);
						});
					else
						user.publish(file);

				});
				return;
			} else if (file.data.length > 10485760) {
				fs.write(file.handler, file.data, null, 'Binary', function(err, data) {
					file.data = '';
				});
			}

			socket.emit('uploading', {'buffer': (file.downloaded / 524288), 'percent': ((file.downloaded / file.size) * 100), bytes: file.downloaded});
		});
	});
});

// File upload

// Utils stuff

function rand(l, c) {
	c = c || '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
	for (var i = l, r = ''; i > 0; --i) 
		r += c[Math.round(Math.random() * (c.length - 1))];
	return r;
}

function encrypt(str) {
	var cipher = crypto.createCipher('aes-256-cbc','d6F3Efeq')
	var crypted = cipher.update(str,'utf8','hex')
	crypted += cipher.final('hex');
	return crypted;
}

Object.defineProperty(Number.prototype,'fileSize',{value:function(a,b,c,d){
	return (a=a?[1e3,'k','B']:[1024,'K','iB'],b=Math,c=b.log,
	d=c(this)/c(a[0])|0,this/b.pow(a[0],d)).toFixed(2)
	+' '+(d?(a[1]+'MGTPEZY')[--d]+a[2]:'Bytes');
},writable:false,enumerable:false});

function hash(str) {
	return Math.abs(s.split("").reduce(function(a,b){a=((a<<5)-a)+b.charCodeAt(0);return a&a},0));              
}