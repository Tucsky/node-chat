var Client = function() {
	var that = this;

	that.$input = $('form#controls textarea');
	that.$messages = $('div#messages ul');
	that.$users = $('ul#users');
	that.$login = null;
	that.$register = null;

	that.cookie = {
		id: rand(16),
		indent: false,
		syntax: false,
		language: null,
		textarea: false
	};

	that.user = {};
	that.users = [];
	that.messages = {};
	that.last = null;
	that.ping = {};
	that.file = null;
	that.reader = null;
	that.autoscroll = true;

	that.uied = false;
	that.online = false;
	that.xhring = false;

	that.init = function() {
		that.$login = new that.modal({id: 'login', autoshow: false});
		that.$register = new that.modal({id: 'register', autoshow: false});

		that.cookie = $.extend(that.cookie, JSON.parse(($.cookie('node') || '{}')));
		$.cookie('node', JSON.stringify(that.cookie));

		that.connect();
		that.events();
		that.settings(null, true);

		return that;
	}

	that.search = function(id) {
		for (var i = 0; i < that.users.length; i++) {
			if (that.users[i].id == id) return that.users[i];
		}
		return {};
	}

	that.settings = function(o, setup) {
		var o = o || {};
		delete o.id;

		// Sauvegarde du cookie "node"
		$.extend(that.cookie, o);
		$.cookie('node', JSON.stringify(that.cookie), {expires: 365 * 10});

		// Active/desactive le mode multiligne
		if (typeof o.textarea !== 'undefined' || setup) {
			$('form#controls .input').hide();
			$('form#controls '+(that.cookie.textarea ? 'textarea' : 'input')+'.input').show();
			$('form#controls').attr('class', 'has-'+(that.cookie.textarea ? 'textarea' : 'input'));
			that.$input = $('form#controls '+(that.cookie.textarea ? 'textarea' : 'input')+'.input');
		}

		// Active/desactive l'editeur avancé (behave.js)
		if (typeof o.indent !== 'undefined' || setup)
			if (that.cookie.indent)
				(that.editor && that.editor.destroy()), (that.editor = new Behave({
					textarea: $('form#controls textarea.input').get(0),
					softTabs: false
				}));
			else
				that.editor && that.editor.destroy();

		// Active/desactive le mode developpeur (coloration syntaxique + police monospace)
		if (typeof o.syntax !== 'undefined' || setup) {
			if (that.cookie.syntax)
				$('form#controls textarea.input').addClass('code');
			else
				$('form#controls textarea.input').removeClass('code');
		}

		// Synchronisation des variables UI
		that.reloadUI(o);

		// Calcul des dimensions de l'interface
		that.resize();

		// Interface prête pour affichage
		that.uied = true;
		that.online && $('#preloader').fadeOut(100);
	}

	that.reloadUI = function(options) {
		var data = $.extend({}, true, that.user, that.cookie, options);

		$('[data-profile]').each(function() {
			var prop = $(this).data('profile'),
				type = $(this).data('type') || 'html';

			if (typeof data[prop] === 'undefined') return;

			switch (type) {
				default:
				case 'html':
					$(this).html(data[prop]);
					break;
				case 'val': 
					$(this).val(data[prop]);
					break;
				case 'bool': 
					if (data[prop])
						$(this).addClass('active'), 
						$('[data-require="'+prop+'"]').show();
					else
						$(this).removeClass('active'), 
						$('[data-require="'+prop+'"]').hide();
					break;
			}
		});
	}

	that.upload = function(file, env, onStart, onProgress, onComplete, onError) {
		if (that.file && that.file.name) return new that.message({content: 'Transfers du fichier "'+that.file.name+'" déjà en cours', class: 'text-danger'});
		
		that.file = file;
		that.file.id = rand(16);
		that.file.onStart = onStart || function(file) {
			new that.message({id: file.id, type: 'html', nomerge: true, content: 'Partage du fichier "'+file.name+'"<div class="progress"><div></div></div><div class="state">0.0 kB / '+file.size.fileSize(1)+'</div>'});
		};
		that.file.onProgress = onProgress || function(file, bytes) {
			if (!that.messages[file.id])
				if (typeof that.file.onStart === 'function') 
					that.file.onStart(file);
				else
					return;
			var $li = that.messages[file.id].container;
				$li.find('.state').html(bytes.fileSize(1)+' / '+file.size.fileSize(1));
				$li.find('.progress div').css({width: ((bytes / file.size) * 100)+'%'});
		};
		that.file.onComplete = onComplete || function(file) {
			if (!that.messages[file.id])
				if (typeof that.file.onStart === 'function') 
					that.file.onStart(file);
				else
					return;
			var $li = that.messages[file.id].container.addClass('box-success');
				$li.find('.state').html('<span class="text-success">Uploadé! ('+file.size.fileSize(1)+') <a href="'+file.path+'" target="_blank">Lien direct</a></span>');
				$li.find('.progress div').css({width: '100%'});
		};
		that.file.onError = onError || function(file, error) {
			if (!that.messages[file.id])
				if (typeof that.file.onStart === 'function') 
					that.file.onStart(file);
				else
					return;
			var $li = that.messages[file.id].container.addClass('box-danger');
				$li.find('.state').html('<span class="text-danger">'+(error || 'Une erreur est survenue')+'</span>');
		};

		that.reader = new FileReader();

		that.reader.onload = function(e) {
			that.io.emit('upload', {'id': that.file.id, buffer: e.target.result});
		}

		that.io.emit('start', {
			id: that.file.id,
			name: that.file.name,
			size: that.file.size,
			env: env
		});

		if (typeof that.file.onStart === 'function') that.file.onStart(that.file);
	}

	that.connect = function() {
		new that.message({content: 'Connexion en cours', class: 'text-primary'});

		that.io = io.connect('/', {
			'sync disconnect on unload': true,
			'path': '/chat/socket.io'
		});

		that.io.on('init', function(data) {
			that.online = true;
			that.uied && $('#preloader').fadeOut(100);

			that.$messages.html('');
			that.$users.html('');

			that.users = data.users;
			that.user = that.search(data.user.id);

			$('#menu .avatar').css({
				'background-image': 'url(avatar/'+that.user.id+')'
			});

			for (var i = 0; i < that.users.length; i++)
				that.$users.append('<li id="user-'+that.users[i].id+'" data-uid="'+that.users[i].id+'" class="user tips'+(that.users[i].id == that.user.id ? ' you' : '')+'" data-placement="right" title="'+that.users[i].nickname+'" style="background-image: url(avatar/'+that.users[i].id+');"></li>')

			new that.message({content: 'Bienvenue '+data.user.nickname+' !', class: 'text-muted'});
			data.welcome && data.welcome.length && new that.message({content: data.welcome, class: 'text-warning'});

			for (var i = 0; i < data.messages.length; i++)
				new that.message(data.messages[i]);

			that.$users.find('.tips').tooltip({container: 'body'});
		});

		that.io.on('join', function(user) {
			new that.message({content: user.nickname+' a rejoins la conversation', class: 'text-muted'});
			that.users.push(user);
			that.$users.append('<li id="user-'+user.id+'" data-uid="'+user.id+'" class="user tips'+(user.id == that.user.id ? ' you' : '')+'" data-placement="right" title="'+user.nickname+'" style="background-image: url(avatar/'+user.id+');"></li>');
			that.$users.find('li:last').tooltip({container: 'body'});
		});

		that.io.on('leave', function(data) {
			if (!that.search(data.user.id).id || !(socket = that.search(data.user.id))) return;
			
			new that.message({content: socket.nickname+' s\'est déconnecté', class: 'text-muted'});
			that.$users.find('[data-uid="'+socket.id+'"]').fadeOut(100, function() {
				$(this).remove();
			});
		});

		that.io.on('message', function(data) {
			new that.message(data);
		});

		that.io.on('dialog', function(data) {
			new that.modal(data);
		});

		that.io.on('profile', function(user, changes) {
			if (!that.search(user.id).id || !(socket = that.search(user.id))) return;

			$.extend(socket, changes);
			if (typeof changes.nickname !== 'undefined')
				$('[data-uid="'+socket.id+'"]').attr('data-original-title', socket.nickname);

			if (typeof changes.avatar !== 'undefined')
				$('[data-uid="'+socket.id+'"]'+(socket.id == that.user.id ? ', .avatar' : '')).css('background-image', 'url(avatar/'+socket.id+'?'+socket.avatar+')');

			that.settings();
		});

		that.io.on('pong', function() {
			clearTimeout(that.ping.timeout);
			new that.message('pong, '+(+new Date - that.ping.time)+'ms');
		});

		that.io.on('disconnect', function(data) {
			new that.message({content: 'Connexion perdue', class: 'text-danger'});
		});

		that.io.on('uploading', function(data) {
			if (!that.file) return;

			if (typeof that.file.onProgress === 'function') 
				that.file.onProgress(that.file, data.bytes);

			var buffer = data.buffer * 524288;
			that.reader.readAsBinaryString(that.file.slice(buffer, buffer + Math.min(524288, (that.file.size - buffer))));
		});

		that.io.on('complete', function(data) {
			if (!that.file) return;

			if (data.file && data.file.path) {
				if (typeof that.file.onComplete === 'function') 
					that.file.onComplete(data.file);
				else
					new that.message({content: 'Fichier "'+that.file.name+'" uploadé avec succès', class: 'text-primary'});
			} else {
				if (typeof that.file.onError === 'function') 
					that.file.onError(that.file, data.error);
				else
					new that.message({content: data.error ? data.error : 'Une erreur est survenue de l\'upload du fichier', class: 'text-danger'});
			}
			that.file = null;
		});
	}

	that.message = function(o) {
		var Message = this, o = (typeof o === 'string' ? {content: o} : o) || {};

		// Paramètres basiques
		Message.content = o.content || null;
		Message.class = o.class || 'default';
		Message.author = o.author || null;
		Message.type = o.type || 'text';
		Message.timestamp = o.timestamp || null;
		Message.target = o.target || null;
		Message.own = (Message.author && Message.author.id == that.user.id);

		// Récuperation du container message
		Message.recovery = false;
		Message.nomerge = o.nomerge || false;
		Message.replace = o.rs || false;
		Message.linebreak = o.br || true;



		if (that.last) {
			console.info(!that.last.nomerge && !Message.nomerge);
			console.log(JSON.stringify(that.last.author) == JSON.stringify(Message.author));
			console.log(that.last.class == Message.class);
			console.warn(JSON.stringify(that.last.target) == JSON.stringify(Message.target));
		}
		if (typeof that.message[o.id] !== 'undefined')
			Message.recovery = true;
		else if (that.last && 
		(!that.last.nomerge && !Message.nomerge &&
		JSON.stringify(that.last.author) == JSON.stringify(Message.author) &&
		that.last.class == Message.class &&
		JSON.stringify(that.last.target) == JSON.stringify(Message.target)))
			Message.recovery = true,
			Message.id = that.last.id;

		Message.id = Message.id || o.id || parseInt(rand(8, '0123456789'));
		Message.container = ($('[data-mid="'+Message.id+'"]').length ? $('[data-mid="'+Message.id+'"]') : $('<li/>', {
			class: 'fade'+(Message.class ? ' '+Message.class : '')+(Message.own ? ' you' : '')+(Message.author ? ' author' : ''),
			'data-mid': Message.id
		}).append('<div class="message-table">\
			'+(Message.author ? '<div class="user-cell">\
				<div class="user tips" id="user-'+Message.author.id+'" data-uid="'+Message.author.id+'" data-placement="top" title="'+Message.author.nickname+'" style="background-image:url(avatar/'+Message.author.id+');">\
					<span class="nickname">'+Message.author.nickname+'</span>\
				</div>\
			</div>' : '')+'\
			<div class="message-cell">\
				<div class="message">\
					<div class="txt-container"></div>\
					'+(Message.timestamp ? '<div class="timestamp" data-time="'+Message.timestamp+'">'+ago(Message.timestamp)+'</div>' : '')+'\
				</div>\
			</div>\
		</div>').appendTo(that.$messages));

		Message.append = function(content) {
			var content = content || Message.content;
			if (!content) return;

			var $container = Message.container.find('.txt-container');
			var $count = $container.find('span').length;
			var options = {};
				options[Message.type] = content;
			var $span = $('<span/>', options);
			$span.html($span.html().replace(/\[code(?:=([a-z]*))?](?:\n)?([\s\S]*)(?:\n)?\[\/code]/g, function(input, syntax, code) {
				return '<pre><code'+(syntax && syntax.length ? ' class="'+syntax+'"': '')+'>'+code+'</code></pre>';
			}).replace(/\n/g, '<br>').replace(/(http\:\/\/www.|https\:\/\/www.|http:\/\/|https:\/\/|www\.)([a-zA-Z0-9\-\.?]+\.[a-zA-Z]{2,6})([a-zA-Z0-9\/#=\.:%!\\_\-\?&]*)/g, function(url) {
				if (url.length > 50) 
					return '<a href="'+url+'" target="_blank">'+url.substr(0,30)+'<i>'+url.substr(30,url.length-20)+'</i>'+url.substr(-20,20)+'</a>';
				else 
					return "<a href='"+url +"' target='_blank'>"+url+"</a>";  
			}));

			$span.find('pre code').each(function(i, elem) {
				hljs.highlightBlock(elem);
			});

			$container.append((!Message.replace && Message.linebreak && $count) ? '<br>' : '', $span);

			Message.container.addClass('in').find('.timestamp').data('time', Message.timestamp).html(ago(Message.timestamp));

			Message.own && (that.autoscroll = true);
			that.resize(true);
		}

		Message.content && Message.append(Message.content);

		!that.messages[Message.id] && (that.last = Message), Message.container.find('.tips').tooltip({container: 'body'});
		that.messages[Message.id] = Message;

		return Message;
	}

	that.send = function() {
		var $input = $('form#controls .input:visible');
		var message = $input.val().replace(/^\s+|\s+$/g, '');
		if (!message.length) return;

		if ((command = /^\/([a-z0-9_-]{1,10})\s?([\s\S]*)/.exec(message))) {
			if (typeof that.cmd[command[1]] === 'function') {
				var name = command[1],
					argument = command[2];

				if (that.cmd[command[1]](argument, message)) new that.message(message);
			} else {
				that.io.emit('input', message);
			}
		} else {
			that.io.emit('input', (that.cookie.syntax && that.cookie.textarea ? '[code'+(that.cookie.language ? '='+that.cookie.language : '')+']'+message+'[/code]' : message));
		}

		$input.focus();
		$input.val('');
	}

	that.events = function() {
		$('.switch').bootstrapSwitch({
			offColor: 'danger',
			onSwitchChange: function(e, state) {
				if (!$(this).data('option')) return;
				var option = {};
					option[$(this).data('option')] = state;
				that.settings(option);
			}
		});

		$('form#controls').submit(function(e) {
			e.preventDefault();
			that.send();

			return false;
		});

		$('form#controls .send').on('click', function() {
			that.send();
		});

		$('form#controls button').on('focus', function() {
			$('form#controls .send').trigger('hover');
		});

		$('.settings').on('click', function(e) {
			$('.st-container').addClass('st-menu-open');
			that.settings();
			e.stopPropagation();
		});

		$('.st-menu').on('click', function(e) {
			e.stopPropagation();
		});

		$('.avatar').click(function() {
			$('#opt-avatar').click();
		})

		$('#opt-avatar').on('change', function(e) {
			if (!e.target.files.length) return;
			that.upload(e.target.files[0], 'avatar');
		});

		$(document).on('click', function(e) {
			if (!$('.st-container').hasClass('st-menu-open')) return;
			$('.st-container').removeClass('st-menu-open');
		});

		$('[data-profile][data-onkeyup]').keyup(function() {
			var $input = $(this);

			clearTimeout($input.data('timeout'));

			$input.data('timeout', setTimeout(function() {
				var option = {};
					option[$input.data('profile')] = $input.val();
				that.io.emit('profile', option);
			}, 500));
		});

		$('[data-profile][data-type="bool"]').on('click', function() {
			var option = {};
				option[$(this).data('profile')] = !$(this).hasClass('active');
			that.settings(option);
		});

		$('.st-pusher').on('dragover', function(e) {
			e.preventDefault();
			e.stopPropagation();
		}).on('dragenter', function(e) {
			e.preventDefault();
			e.stopPropagation();
		}).on('drop', function(e) {
			if (e.originalEvent.dataTransfer && e.originalEvent.dataTransfer.files[0] && e.originalEvent.dataTransfer.files[0].name) {
				e.preventDefault();
				e.stopPropagation();
				that.upload(e.originalEvent.dataTransfer.files[0], 'hosting');
			}
		});

		$('.tips').tooltip({container: 'body'});
		$('#messages').on('scroll', function() {
			that.autoscroll = $(this).get(0).scrollHeight - $(this).scrollTop() <= $(this).height() ? true : false;
		});

		$('#users, #messages').on('click', '.user', function() {
			if ($(this).attr('id') == 'user-'+that.user.id) return;

			that.$input.val('/w '+($(this).data('original-title') || $(this).attr('title')).replace(/ /g, '_')+' ');
			that.$input.focus();
		});

		$('span.clear-id').on('click', function() {
			if (confirm("Etes-tu sur de vouloir obtenir un nouvel ID ?")) {
				$.cookie('node', null, {path: '/'});
				location.reload();
			}
		});

		$('.st-pusher').on('swiperight', function(e) {
			$('.st-container').addClass('st-menu-open');
			that.settings();
			e.stopPropagation();
		});

		$('.st-menu').on('swipeleft', function(e) {
			$('.st-container').removeClass('st-menu-open');
		});

		$('.dialog#login form').submit(function(e) {
			e.preventDefault();

			that.io.emit('input', {
				login: $(this).find('[name=login]').val(), 
				password: $(this).find('[name=password]').val()
			});
		});

		that.resize();
		$(window).resize(that.resize);
		setInterval(that.repeater, 1000);
	}

	that.repeater = function() {
		that.resize();
		$('.timestamp').each(function() {
			$(this).data('time') && $(this).html(ago($(this).data('time')));
		});
	}

	that.resize = function(scroll) {
		$('#messages').height($(window).height() - parseInt($('#app').css('paddingLeft')) * 2 - $('#controls').height() - 15);
		if ($('#messages > ul').height() > $('#messages').height()) 
			$('#messages').addClass('hasscroller');
		else
			$('#messages').removeClass('hasscroller');

		scroll && that.autoscroll && $('#messages').scrollTop($('#messages ul').height());
	}

	that.xhr = function(state) {
		if ((that.xhring = state))
			$('body').addClass('xhring');
		else
			$('body').removeClass('xhring');
	}

	that.ajax = function(options) {
		that.xhr(true);

		var ajax = {
			url: options.url,
			type: options.type || 'get',
			data: options.data || {}
		}

		if (options.xhr) {
			ajax.data = new FormData(options.xhr);
			ajax.type = 'post';
			ajax.xhr = function() {
				var myXhr = $.ajaxSettings.xhr();
				if (myXhr.upload) {
					myXhr.upload.addEventListener('progress', function(e) { 
						if (e.lengthComputable) {
							var percent = e.loaded / e.total;
							console.info('xhring', (percent * 100)+'%', '('+e.loaded+'/'+e.total+')');
						}
					}, false);
				}
				return myXhr;
			};
			ajax.cache = false;
			ajax.contentType = false;
			ajax.processData = false;
		}

		$.ajax(ajax).always(function(json) {
			that.xhr(0);
			if (!json.success) {
				if (json.error) {
					if (typeof options.onError === 'function') options.onError(json.error, json.data);
					else {
						new that.modal({
							title: 'Erreur',
							content: json.error.join('<br>'),
							class: 'danger'
						});
					}
				} else {
					new that.modal({
						title: 'Erreur',
						content: typeof json != 'object' ? 'La réponse n\'est pas au format valide JSON' : 'L\'objet reçu n\'est pas reconnu en tant que réponse valide',
						class: 'danger'
					});
				}
			}
		}).done(function(json) { 
			if (json.success) {
				if (typeof options.onDone === 'function') options.onDone(json.data, json.message); 
			}
		}).fail(function(xhr, status, detail) {
			var error = "Erreur inconnue";

			switch (status) {
				case "error":
					error = "<strong>Erreur Apache</strong><br>"+xhr.status+" "+xhr.statusText;
					break;
				case "timeout":
					error = "<strong>Erreur réseau</strong><br>Délai d'attente dépassé";
					break;
				case "parsererror":
					error = "<strong>Format de réponse invalide</strong><br>La réponse n'est pas au format JSON valide";
					break;
				case "abort":
					error = "<strong>Erreur Apache</strong><br>La connexion a été intérompu";
					break;
			}

			new that.modal({
				title: 'Erreur',
				content: error+"<br><br><strong>Détails</strong><br><code>"+detail+"</code>",
				class: 'danger'
			});
		});
	}

	that.modal = function(options) {
		var modal = this;

		if (typeof options === 'string') 
			options = {id: options};
		else
			options = options || {};

		modal.id = options.id || rand(8);
		modal.options = $.extend({
			autoshow: true
		}, options);

		var exists = $('.dialog#'+modal.id).length ? true : false,
			$container = exists ? $('.dialog#'+modal.id) : $('<div/>', {id: modal.id, class: 'dialog'+(options.class ? ' '+options.class : '')});

		modal.init = function() {
			if (modal.options.ajax) {
				that.ajax({
					url: modal.options.ajax,
					onDone: function(html) {
						if (!html || !html.length) return new that.modal({class: 'danger', title: 'Erreur', content: 'Aucune donnée reçue.'});
						options.ajax = null;
						options.content = html;
						return new that.modal(options);
					}
				});
				return;
			}

			if (exists && !$container.data('init')) {
				console.log('yes it exists, not it has not been initialized');
				modal.options.title = $container.attr('title');
				modal.options.content = $container.html();
				$container.html('');

				var preventAppend = true;
					exists = false;
			}

			if (!exists) {
				if (!modal.options.id) modal.ephemeral = true;

				var $close = $('<div class="toggle-close" title="Fermer"><div class="io-cancel"></div></div>').on('click', modal.hide),
					$header = $('<div/>', {class: 'header'}).append('<div class="title"></div>', !modal.options.noclose ? $close : '');
					$content = $('<div/>', {class: 'content'+(modal.options.paddingless ? ' paddingless' : '')}),
					$footer = $('<div/>', {class: 'footer'}),
					$overlay = $('<div/>', {overlay: modal.id}).on('click', modal.hide);

				$container.append($header, $content, $footer).data('init', true);
				if (!modal.options.floater) $container.before($overlay);
				typeof preventAppend === 'undefined' && $('body').append($container);
			} else {
				if (!modal.options.header && !modal.options.content && !modal.options.footer && !modal.options.ajax) return modal;
			}

			return modal.update();
		}

		modal.update = function() {
			if (typeof modal.options.title !== 'undefined') 
				if (modal.options.title.length)
					$container.find('.header').show().find('.title').html(modal.options.title);
				else
					$container.find('.header').hide();

			if (typeof modal.options.content !== 'undefined') 
				if (modal.options.content.length)
					$container.find('.content').show().html(modal.options.content);
				else
					$container.find('.content').hide();

			if (typeof modal.options.buttons !== 'undefined') 
				if (modal.options.content.length)
					for (var i = 0; i < modal.options.buttons.length; i++) {
						var $button = $('<button/>', {
							type: 'button',
							class: 'btn '+(modal.options.buttons[i].class ? modal.options.buttons[i].class : 'btn-primary')
						}).html(modal.options.buttons[i].text);
						modal.options.buttons[i].close && $button.on('click', function() { modal.hide(); })
						modal.options.buttons[i].click && typeof modal.options.buttons[i].click === 'function' && $button.on('click', function() { modal.options.buttons[i].click(modal); });

						$container.find('.footer').show().append($button);
					}
				else
					$container.find('.footer').hide();

			return modal.options.autoshow ? modal.show() : modal;
		}

		modal.show = function(callback) {
			clearTimeout($container.data('timeout'));
			modal.center();

			$('[overlay="'+modal.id+'"]').fadeIn(100);
			$container.show();
			var index = $(".dialog:visible").index($('#'+modal.id));
			setTimeout(function() {
				$container.css({
					'top': 50 + (index * 10)
				});
			}, 10);
			$container.data('timeout', setTimeout(function() {
				if (typeof callback === 'function') callback.apply(this, modal);
			}, 500));

			return modal;
		}

		modal.center = function(callback) {
			$container.css({
				'left': ($(window).width() / 2) - ($container.width() / 2),
			});
		}

		modal.hide = function(callback) {
			clearTimeout($container.data('timeout'));
			$('[overlay="'+modal.id+'"]').fadeOut(100);

			$container.css({
				'top': ($container.height() * -1) - 50
			});
			$container.data('timeout', setTimeout(function() {
				$container.hide();
				modal.ephemeral && modal.remove();
				if (typeof callback === 'function') callback.apply(this, modal);
			}, 500));

			return modal;
		}

		modal.remove = function(callback) {
			$container.add('[overlay="'+modal.id+'"]').remove();

			return null;
		}

		return modal.init();
	}

	that.cmd = {
		clear: function(arg) {
			that.$messages.html('');
			that.messages = {};
			new that.message('Messages effacés');
			return true;
		},
		ping: function(arg, raw) {
			that.ping.time = +new Date();
			that.ping.timeout = setTimeout(function() {
				new that.message('Aucun ping n\'a été reçu');
			}, 5000);
			that.io.emit('input', raw);
			return true;
		},
		syntax: function(arg) {
			that.settings({syntax: arg == 'on' ? true : (arg == 'off' ? false : (arg.length ? true : !that.cookie.syntax))});
			new that.message('Mode coloration syntaxique '+(that.cookie.syntax ? 'activé' : 'désactivé'));
			if (arg.length && arg != 'on' && arg != 'off') {
				if (that.syntax.indexOf(arg) != -1) {
					that.settings({language: arg});
					new that.message({content: 'Coloration syntaxique "'+arg+'" appliquée par défault', class: 'text-success'});
				} else if (arg == 'auto') {
					that.settings({language: null});
					new that.message({content: 'Détection automatique appliqué par défault', class: 'text-success'});
				} else if (arg == 'help') {
					new that.message({content: '<code>/syntax on/off</code> Active ou désactive la coloration syntaxique<br><code>/syntax [language_name]</code> Force la coloration sur la base d\'un langage spécifique ("auto" pour détécter automatiquement)', type: 'html', class: 'text-muted'});
				} else {
					new that.message({content: 'La coloration syntaxique "'+arg+'" n\'existe pas', class: 'text-danger'});
				}
			}
		},
		textarea: function(arg) {
			that.settings({textarea: arg == 'on' ? true : (arg == 'off' ? false : !that.cookie.textarea)});
			new that.message('Mode textarea '+(that.cookie.textarea ? 'activé' : 'désactivé'));
		},
		indent: function(arg) {
			that.settings({indent: arg == 'on' ? true : (arg == 'off' ? false : !that.cookie.indent)});
			new that.message('Support de l\'indentation '+(that.cookie.indent ? 'activé' : 'désactivé'));
		},
		login: function(arg) {
			that.$login.show();
		},
		register: function(arg) {
			that.$register.show();
		},
		nick: function(arg) {
			that.io.emit('profile', {nickname: arg});
		},
		set: function(arg) {
			var arg = arg.split(':');
			if (arg.length < 2) return new that.message({content: "Les propriétés doivent être de type <code>foo:bar</code>", type: 'html', class: 'text-danger'});

			var option = {};

			try {
				var parsed = JSON.parse(arg[1]);
			} catch(e) {
				console.log(e);
			}
			option[arg[0]] = parsed || arg[1];
			$.extend(that.cookie, option);
			that.settings(option);

			return new that.message({content: "La propriété <code>\""+arg[0]+"\"</code> vaut maintenant <code>\""+arg[1]+"\"</code>", type: 'html'});
		}
	}

	that.syntax = ['js', 'php', 'coffeescript', 'bash', 'python', 'xml', 'javascript', 
					'http', 'cpp', 'sql', 'clojure', 'cs', 'objectivec', 'java', 
					'swift', 'css', 'ruby', 'makefile', 'go', 'ini', 
					'perl', 'nginx', 'diff', 'json'];

	that.init();
}

function rand(l, c) {
	c = c || '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
	for (var i = l, r = ''; i > 0; --i) 
		r += c[Math.round(Math.random() * (c.length - 1))];
	return r;
}

function ago(time) {
	var pluriel = function(str, n) {
		return str.slice(0, n > 1 ? Infinity : -1);
	}

	var seconds = Math.floor((new Date() - (time - 1000)) / 1000),
		interval = Math.floor(seconds / 31536000);
	if (seconds < 1) return 'À l\'instant';
	if (interval >= 1) return interval + pluriel(" ans", interval);
	interval = Math.floor(seconds / 2592000);
	if (interval >= 1) return interval + " mois";
	interval = Math.floor(seconds / 86400);
	if (interval >= 1) return interval + pluriel(" jours", interval);
	interval = Math.floor(seconds / 3600);
	if (interval >= 1)  return interval + pluriel(" heures", interval);
	interval = Math.floor(seconds / 60);
	if (interval >= 1) return interval + pluriel(" mins", interval);
	return Math.floor(seconds) + pluriel(" secs", Math.floor(seconds));
}

Object.defineProperty(Number.prototype,'fileSize',{value:function(a,b,c,d){
	return (a=a?[1e3,'k','B']:[1024,'K','iB'],b=Math,c=b.log,
	d=c(this)/c(a[0])|0,this/b.pow(a[0],d)).toFixed(2)
	+' '+(d?(a[1]+'MGTPEZY')[--d]+a[2]:'Bytes');
},writable:false,enumerable:false});

(function($) {
    var origAppend = $.fn.append;

    $.fn.append = function () {
        return origAppend.apply(this, arguments).trigger("append");
    };
})(jQuery);