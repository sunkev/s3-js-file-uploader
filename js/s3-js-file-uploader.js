function Config(maxFileSize, bucket, accessKey, secretKey, folderName){
  this.maxFileSize      = maxFileSize;
  this.bucket           = bucket;
  this.accessKey        = accessKey;
  this.secretKey        = secretKey;
  this.multipartMinSize = 5 * 1024 * 1024;
  this.folderName       = folderName
}

function TemplateRenderer(uploadTemplate) {
  _.templateSettings = {interpolate: /\{\{(.+?)\}\}/g};
  this.$template = $(uploadTemplate);

  this.renderedUploadTemplate = function(fileNumber, file){
    var template = _.template(this.$template.html());
    return template({fileNumber: fileNumber, file: file});
  };

  this.renderXML = function(upload){
    var XML = '<CompleteMultipartUpload>';
    upload.parts.forEach(function(part){
        XML = XML +
          '  <Part>' +
          '    <PartNumber>'+part.partNumber+'</PartNumber>' +
          '    <ETag>'+part.ETag+'</ETag>' +
          '  </Part>';
      }
    );
    return XML + '</CompleteMultipartUpload>';
  };

  _.bindAll(this, "renderedUploadTemplate", "renderXML");
}

function Signer(upload){
  // exists because date has to be set right before ajax request, else there is a request time out after 15 mins
  this.upload           = upload;
  var config    = upload.config;
  var bucket    = config.bucket;
  var awsObjURL = upload.awsObjURL;
  var uploadId  = upload.uploadId;

  this.date             = new Date().toUTCString();
  this.initSingleStr    = 'PUT\n\nmultipart/form-data\n\nx-amz-date:'+this.date+'\n/'+bucket+'/'+awsObjURL;
  this.initMultiStr     = 'POST\n\n\n\nx-amz-date:'+this.date+'\n/'+bucket+'/'+awsObjURL+'?uploads';

  this.abortStr         = function(){
    return 'DELETE\n\n\n\nx-amz-date:'+this.date+
      '\n/'+bucket+'/'+
      awsObjURL+
      '?uploadId='+uploadId;
  };

  this.finishMultiStr   = function(){
    return 'POST\n\ntext/plain;charset=UTF-8\n\nx-amz-date:'+this.date+
      '\n/'+bucket+'/'+
      awsObjURL+
      '?uploadId='+uploadId;
  };

  this.multipartInitURL = 'https://' + bucket + '.s3.amazonaws.com/'+awsObjURL+'?uploads';

  this.singlepartInitURL = 'https://' + bucket + '.s3.amazonaws.com/'+awsObjURL;

  this.partUploadURL = 'https://' + bucket + '.s3.amazonaws.com/'+awsObjURL+'?uploadId='+uploadId;

  // part stuff
  this.partStr = function(part){
    return 'PUT\n\nmultipart/form-data\n\nx-amz-date:' + this.date +
      '\n/' + bucket + '/' +
      awsObjURL +
      '?partNumber=' + part.partNumber +
      '&uploadId=' + uploadId;
  };
  this.partURL = function(part){
    return 'https://' + bucket + '.s3.amazonaws.com/' +
      awsObjURL +
      '?partNumber=' + part.partNumber
      + '&uploadId=' + uploadId;
  };

  this.encryptAuth = function(stringToSign){
    var crypto = CryptoJS.HmacSHA1(stringToSign, config.secretKey).toString(CryptoJS.enc.Base64);
    return 'AWS'+' '+config.accessKey+':'+crypto
  };

  _.bindAll(this, "abortStr", "finishMultiStr", "partStr", "partURL", "encryptAuth");

}

function Handler(uploader, options){
  this.uploader = uploader;

  this.successPartUploadHandler = function(part, jqXHR, callback){
    part.ETag = jqXHR.getResponseHeader('ETag').replace(/"/g, '');
    part.upload.completedParts.push(part);

    if (part.upload.$progressBar[0]){
      var percent = Math.round((part.upload.completedParts.length / part.upload.totalChunks ) * 100)+'%';
      part.upload.$status.html(percent);
      part.upload.$progressBar.width(percent);
    }

    this.customSuccessPartHandler();
    if (part.upload.totalChunks === part.upload.completedParts.length){
      callback(part.upload)
    }
  };

  this.successUploadCompleteHandler = function(upload){
    this.uploader.completedUploads.push(upload);
    this.customSuccessHandler();
    if (this.uploader.completedUploads.length === this.uploader.uploadQueue.length){
      this.allUploadsFinishedHandler();
      this.uploader.completedUploads = [];
    }
  };

  // two types of uploads, so callback needs to be passed in
  this.initUploadFailureHandler = function(upload, callback){
    upload.retries += 1;
    if(upload.retries < 4)
    {
      setTimeout(function() {
        callback(upload);
      }, 2000);
    }
    else
    {
      upload.uploadFailed();
      console.log('Upload' + ' ' + upload.file.name + ' has failed to start uploading')
    }
  };

  this.partUploadFailure = function(part){
    var uploader = this.uploader;
    part.retries += 1;
    if(part.retries < 4)
    {
      setTimeout(function() {
        uploader.sendPartToAmazon(part);
      }, 2000);

      console.log('Upload'+' '+part.upload.file.name+' part '+part.partNumber+' has failed to start uploading and is retrying')
    }
    else
    {
      this.multiPartFailUploadHandler(part.upload);
      console.log('Upload'+' '+part.upload.file.name+' part '+part.partNumber+' has failed to start uploading 3 times');
      part.upload.uploadFailed();
      console.log('Upload' + ' ' + part.upload.file.name + ' has failed to start uploading')
    }
  };


  this.multiPartFailUploadHandler = function(upload){
    upload.retries += 1;
    if(upload.retries < 4)
    {
      setTimeout(function() {
        this.completeMultipart(upload);
      }, 2000);
    }
    else
    {
      var auth = this.encryptAuth(upload.abortStr());
      $.ajax({
        url : 'https://' + upload.config.bucket + '.s3.amazonaws.com/'+encodeURI(upload.awsObjURL)+'?uploadId='+upload.uploadId,
        type: 'DELETE',
        beforeSend: function (xhr) {
          xhr.setRequestHeader("x-amz-date", upload.date);
          xhr.setRequestHeader("Authorization", auth);
        }
      });
      upload.uploadFailed();
      console.log('Upload' + ' ' + upload.file.name + ' multipart upload did not combine')
    }
  };

  this.customSuccessPartHandler = function(){};

  this.allUploadsFinishedHandler = function(){};

  this.customSuccessHandler = function(){};

  $.extend(this, options);

  _.bindAll(this, "successPartUploadHandler", "successUploadCompleteHandler", "multiPartFailUploadHandler", "allUploadsFinishedHandler");
}

function UploaderForm(el){
  this.$el = $(el);
  this.$fileInput = $('.fileinput-button');
  this.$container = $('.upload-container');
  this.$table = $('.upload-table');
  this.$tbody = this.$table.children('tbody');
  this.$submit = $('.start');

  this.dragOver = function(e){
    e.preventDefault();
    e.stopPropagation();
    this.$container.addClass('dragover');
  };

  this.dragEnter = function(e){
    e.preventDefault();
    e.stopPropagation();
  };

  _.bindAll(this, "dragOver", "dragEnter");

  this.$container.on('dragover', this.dragOver);
  this.$container.on('dragenter', this.dragEnter);

}

function Upload(el, file, config){
  this.$el              = $(el);
  this.$deleteButton    = this.$el.find('.delete-upload');
  this.$progressBar     = this.$el.find('.progress-bar');
  this.$status          = this.$el.find('.status');
  this.file             = file;
  this.parts            = [];
  this.config           = config;
  this.awsObjURL        = encodeURI(this.config.folderName + '/' + this.file.name).replace(/%20/g, "_");
  this.totalChunks      = Math.ceil(this.file.size / this.config.multipartMinSize);
  this.canUseMultipart  = this.file.size > this.config.multipartMinSize;
  this.completedParts   = [];
  this.retries     = 0;

  this.progressHandler = function(e){
    var percent = Math.round((e.loaded / e.total) * 100)+'%';

    this.$status.html(percent);
    this.$progressBar.width(percent)
  };

  this.uploadFailed = function(){
    this.$progressBar.css('background-color', '#d9534f');
    this.$status.html('Upload Failed');
  };

  _.bindAll(this, "progressHandler", "uploadFailed");
}

function UploadPart(file, partNumber, upload) {
  this.file = file;
  this.partNumber = partNumber;
  this.upload = upload;
  this.startByte = this.upload.config.multipartMinSize * (partNumber - 1);
  this.endByte = this.upload.config.multipartMinSize * (partNumber);
  this.blob = this.file.slice(this.startByte, this.endByte);
  this.ETag = '';

  this.retries = 0;
}

//ConfigurationRetriever: fetches the configuration for submission
//Configuration model: abstraction to reflect the bucket, accessKey, etc

function Uploader(config, handlerOptions){

  //add check for html5
  this.config           = config;
  this.templateRenderer = new TemplateRenderer('#upload-template');
  this.uploadForm       = new UploaderForm('#upload-form');
  this.handler          = new Handler(this, handlerOptions);
  this.uploadQueue      = [];
  this.completedUploads = [];
  this.uploadCounter    = 0;

  this.getFile = function(e){
    e.preventDefault();

    var fileList;
    if(e.target.files === undefined){
      fileList = e.originalEvent.dataTransfer.files;
      this.uploadForm.$container.removeClass('dragover');
    } else {
      fileList = e.target.files;
    }

    for (var i = 0; i < fileList.length; i++) {
      var file = fileList[i];
      var fileNumber = this.uploadCounter++;

      if(file.size > this.config.maxFileSize){
        alert('THIS FILE IS TOO LARGE')
      } else {
        this.addUploadToView(fileNumber, file);
        this.createUpload(fileNumber, file);
      }
    }
  };

  this.addUploadToView = function(fileNumber, file){
    var template = this.templateRenderer.renderedUploadTemplate(fileNumber, file);
    this.uploadForm.$tbody.append(template);
  };

  this.createUpload = function(fileNumber, file){
    var upload = new Upload('.upload-'+fileNumber, file, this.config);
    upload.$deleteButton.on('click', {upload: upload}, this.removeUpload);
    this.uploadQueue.push(upload);
  };

  this.startUploads = function(e){
    e.preventDefault();

    if (0 < this.uploadQueue.length) {
      this.uploadForm.$fileInput.hide();
      this.uploadForm.$submit.hide();
      for (var i = 0; i < this.uploadQueue.length; i++) {
        var upload = this.uploadQueue[i];
        upload.canUseMultipart ? this.initiateMultipartUpload(upload) : this.sendFullFileToAmazon(upload);
      }
      this.uploadQueue.forEach(function(upload){upload.$deleteButton.hide()});
    }
  };

  this.initiateMultipartUpload = function(upload){
    var signer = new Signer(upload);
    var auth = signer.encryptAuth(signer.initMultiStr);
    return $.ajax({
      url : signer.multipartInitURL,
      type: 'post',
      dataType: 'xml',
      context: this,
      beforeSend: function (xhr) {
        xhr.setRequestHeader("x-amz-date", signer.date);
        xhr.setRequestHeader("Authorization", auth);
      },
      success: function(data) {
        upload.uploadId = data.getElementsByTagName("UploadId")[0].innerHTML;
        this.uploadParts(upload);
      },
      error: function(){
        this.handler.initUploadFailureHandler(upload, this.initiateMultipartUpload)
      }
    });
  };

  this.sendFullFileToAmazon = function(upload){
    var signer = new Signer(upload);
    var auth = signer.encryptAuth(signer.initSingleStr);
    $.ajax({
      xhr: function(){
        var xhr = $.ajaxSettings.xhr() ;
        xhr.upload.addEventListener("progress", upload.progressHandler);
        return xhr ;
      },
      url: signer.singlepartInitURL,
      type: 'PUT',
      data: upload.file,
      context: this,
      contentType:'multipart/form-data',
      processData: false,
      beforeSend: function (xhr) {
        xhr.setRequestHeader("x-amz-date", signer.date);
        xhr.setRequestHeader("Authorization", auth);
      },
      success: function() {
        this.handler.successUploadCompleteHandler(upload)
      },
      error: function(){
        this.handler.initUploadFailureHandler(upload, this.sendFullFileToAmazon);
      }
    })
  };

  this.uploadParts = function(upload){
    for(var partNumber=1; partNumber <= upload.totalChunks; partNumber++){
      this.timedUploadPart(partNumber, upload);
    }
  };

  this.timedUploadPart = function(partNumber, upload){
    var uploader = this;
    setTimeout(function(){
      var part = new UploadPart(upload.file, partNumber, upload);
      upload.parts.push(part);
      uploader.sendPartToAmazon(part);
    }, 5000 * partNumber);
  };

  this.completeMultipart = function(upload){
    var signer = new Signer(upload);
    var auth = signer.encryptAuth(signer.finishMultiStr());
    var data = this.templateRenderer.renderXML(upload);

    $.ajax({
      url : signer.partUploadURL,
      type: 'POST',
      dataType: 'xml',
      data: data,
      contentType: false,
      context: this,
      beforeSend: function (xhr) {
        xhr.setRequestHeader("x-amz-date", signer.date);
        xhr.setRequestHeader("Authorization", auth);
      },
      success: function() {
        this.handler.successUploadCompleteHandler(upload)
      },
      error: function() {
        this.handler.multiPartFailUploadHandler(upload)
      }
    })
  };

  this.sendPartToAmazon = function(part){
    var signer = new Signer(part.upload);
    var auth = signer.encryptAuth(signer.partStr(part));

    $.ajax({
      url: signer.partURL(part),
      type: 'PUT',
      dataType: 'xml',
      data: part.blob,
      contentType:'multipart/form-data',
      processData: false,
      beforeSend: function (xhr) {
        xhr.setRequestHeader("x-amz-date", signer.date);
        xhr.setRequestHeader("Authorization", auth);
      },
      context: this,
      success: function(data, textStatus, jqXHR) {
        this.handler.successPartUploadHandler(part, jqXHR, this.completeMultipart)
      },
      error: function() {
        this.handler.partUploadFailure(part)
      }
    })
  };

  this.removeUpload = function(e){
    e.preventDefault();
    var upload = e.data.upload;
    upload.$el.remove();
    this.uploadQueue = _.without(this.uploadQueue, upload)
  };

  _.bindAll(this, "sendPartToAmazon", "removeUpload", "addUploadToView", "createUpload");
  _.bindAll(this, "getFile", "startUploads", "initiateMultipartUpload", "sendFullFileToAmazon");
  _.bindAll(this, "uploadParts", "timedUploadPart", "completeMultipart");

  this.uploadForm.$fileInput.on('change', this.getFile);
  this.uploadForm.$container.on('drop', this.getFile);
  this.uploadForm.$el.on('submit', this.startUploads);

}
