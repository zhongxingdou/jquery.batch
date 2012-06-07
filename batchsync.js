(function () {

  // global namespace
  var root = this;

  // global references
  var Backbone = root.Backbone,
      _ = root._,
      $ = root.$;

  // Backbone.sync alias
  var BackboneSync = Backbone.sync;

  // create our class
  var BatchSync = function (options) {
    this.requests = [];
  };
  BatchSync.extend = Backbone.Model.extend;

  // add our class to the global namespace
  root.BatchSync = BatchSync;

  // our methods
  _.extend(BatchSync.prototype, {

    // pulic method for adding a request to the batch
    add: function (obj, method) {
      obj._batch = this;
      method = _.isString(method) ? obj[method] : method;
      return method.apply(obj, Array.prototype.slice.call(arguments, 2));
    },

    // public method for running the batch request
    sync: function (options) {
      var instance = this;

      // map an array of requests
      var requests = _.map(this.requests, function (data, i) {
        return data.request;
      });

      // setup our base options
      options = _.extend({
        data: requests,
        dataType: 'text'
      }, options);

      // extend the success option
      var success = options.success;
      options.success = function (data, status, xhr) {
        // call our _deliver method to handle each individual batch request response
        instance._deliver.call(instance, data, status, xhr);
        
        // user's success function
        if (success) {
          success(data, status, xhr);
        }
      };

      // call the request
      return BackboneSync.call(Backbone, 'create', this, options);
    },

    url: function () {
      return '/_bulk';
    },

    // private method to add a request to the batch requests array
    _addRequest: function (xhr, settings) {
      // create data object
      var data = {
        xhr: xhr,
        settings: settings,
        request: {
          method: settings.type,
          path: settings.url,
          headers: {},
          body: settings.data
        }
      };

      // extract query params
      var queryparams = this._extractParams(settings.url);

      if (queryparams) {
        // remove query params from url
        data.request.path = settings.url.replace('?' + queryparams, '');

        // decode query params into "query" object if it doesn't already exist
        // if jQuery and $.deparam are present, they will be used
        // otherwise, we use the built-in query param decoder
        data.request.query = settings.query ? settings.query : $ && $.deparam ? $.deparam(queryparams) : this._deparam(queryparams);
      }

      // set request header
      // since the _bulk endpoint merges the outer request into the inner requests
      // here we explicitly send the content-type header for the inner request
      if (settings.contentType) {
        data.request.headers['content-type'] = settings.contentType;
      }

      // set any user-passed headers
      // similar to the request header above, when the user passes headers in the settings.headers object
      // we explicitly set those for the inner requests
      if (settings.headers) {
        _.each(settings.headers, function (value, name) {
          data.request.headers[name.toLowerCase() || name] = value;
        });
      }

      // add request object to the batch requests array
      this.requests.push(data);
    },

    // delivers each batch request response to its intended xhr success/error function
    _deliver: function (data, status, xhr) {
      var instance = this;
      // create an array of returned responses based on newlines and loop through them
      _.each(data.split('\n'), function (response, i) {
        // only work with batch requests that we have stored
        if (!instance.requests[i]) {
          return;
        }

        // grab the stored request data
        var request = instance.requests[i];

        // parse the response
        response = JSON.parse(response);

        // add the response status code to the xhr request
        request.xhr.status = response.status;

        // build statusText a la jQuery based on status code
        request.xhr.statusText = instance._statusText(response.status);

        // grab the user success/error function depending on the batch request response
        var callback = request.settings[request.xhr.statusText == 'error' ? 'error' : 'success'];

        // call the function, if it exists
        if (callback) {
          callback.call(request.xhr, JSON.parse(response.body), request.xhr.statusText, request.xhr);
        }
      });
    },

    // private method to extract query parameters from a string
    _extractParams: function (url) {
      var pos = url.lastIndexOf('?');
      return pos >= 0 ? url.substr(pos + 1) : null;
    },

    // private method to decode query parameters (not very robust)
    _deparam: function (string) {
      var params = {};

      // loop through key/value pairs
      _.each(string.split('&'), function (pair) {
        // extract the key & value
        pair = pair.split('=');

        // add pairs to params object
        params[pair[0]] = pair[1];
      });

      return params;
    },

    // private method to create statusText based on a statusCode a la jQuery
    _statusText: function (code) {
      var statusText = 'error';
      if (code >= 200 && code < 300 || code === 304) {
        if (code === 304) {
          statusText = 'notmodified';
        } else {
          statusText = 'success';
        }
      }
      return statusText;
    }

  });

  // override Backbone.sync to cancel any outgoing requests with a _batch object and add them to the batch requests array
  Backbone.sync = function (method, model, options) {
    // override the jQuery beforeSend method
    var beforeSend = options.beforeSend;
    options.beforeSend = function (xhr, settings) {
      // call the user's beforeSend function, if passed
      if (beforeSend) {
        var before = beforeSend(xhr, settings);

        // cancel request if user's beforeSend function returns false
        if (before === false) {
          return before;
        }
      }

      // we're only worried about models/collections with an added _batch object
      if (model._batch) {
        // add request to batch
        model._batch._addRequest(xhr, settings);

        // remove reference to batch
        delete model._batch;

        // cancel this request
        return false;
      }
    };

    // run original Backbone.sync method for all other requests
    return BackboneSync.call(Backbone, method, model, options);
  };

}).call(this);
