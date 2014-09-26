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

function Handler(options){
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

  this.successUploadCompleteHandler = function(uploader, upload){
    uploader.completedUploads.push(upload);
    this.customSuccessHandler();
    if (uploader.completedUploads.length === uploader.uploadQueue.length){
      this.allUploadsFinishedHandler();
      uploader.completedUploads = [];
    }
  };

  this.multiPartFailUploadHandler = function(upload){
    var auth = this.encryptAuth(upload.abortStr());
    upload.uploadFailed();
    $.ajax({
      url : 'https://' + upload.config.bucket + '.s3.amazonaws.com/'+encodeURI(upload.awsObjURL)+'?uploadId='+upload.uploadId,
      type: 'DELETE',
      beforeSend: function (xhr) {
        xhr.setRequestHeader("x-amz-date", upload.date);
        xhr.setRequestHeader("Authorization", auth);
      }
    })
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
  this.date             = new Date().toUTCString();
  this.totalChunks      = Math.ceil(this.file.size / this.config.multipartMinSize);
  this.canUseMultipart  = this.file.size > this.config.multipartMinSize;
  this.completedParts   = [];
  this.awsObjURL        = encodeURI(this.config.folderName + '/' + this.file.name).replace(/%20/g, "_");
  this.initSingleStr    = 'PUT\n\nmultipart/form-data\n\nx-amz-date:'+this.date+'\n/'+this.config.bucket+'/'+this.awsObjURL;
  this.initMultiStr     = 'POST\n\n\n\nx-amz-date:'+this.date+'\n/'+this.config.bucket+'/'+this.awsObjURL+'?uploads';
  this.abortStr         = function(){
    return 'DELETE\n\n\n\nx-amz-date:'+this.date+
      '\n/'+this.config.bucket+'/'+
      this.awsObjURL+
      '?uploadId='+this.uploadId;
  };

  this.finishMultiStr   = function(){
    return 'POST\n\ntext/plain;charset=UTF-8\n\nx-amz-date:'+this.date+
      '\n/'+this.config.bucket+'/'+
      this.awsObjURL+
      '?uploadId='+this.uploadId;
  };

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
  this.stringToSign = function(){
    return 'PUT\n\nmultipart/form-data\n\nx-amz-date:' + this.upload.date +
      '\n/' + this.upload.config.bucket + '/' +
      upload.awsObjURL +
      '?partNumber=' + this.partNumber +
      '&uploadId=' + this.upload.uploadId;
  };
  this.url = function(){
    return 'https://' + this.upload.config.bucket + '.s3.amazonaws.com/' +
      upload.awsObjURL +
      '?partNumber=' + this.partNumber
      + '&uploadId=' + this.upload.uploadId;
  };
}

function Uploader(config, handlerOptions){

  //add check for html5
  this.config           = config;
  this.templateRenderer = new TemplateRenderer('#upload-template');
  this.uploadForm       = new UploaderForm('#upload-form');
  this.handler          = new Handler(handlerOptions);
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
    var auth = this.encryptAuth(upload.initMultiStr);
    return $.ajax({
      url : 'https://' + upload.config.bucket + '.s3.amazonaws.com/'+upload.awsObjURL+'?uploads',
      type: 'post',
      dataType: 'xml',
      context: this,
      beforeSend: function (xhr) {
        xhr.setRequestHeader("x-amz-date", upload.date);
        xhr.setRequestHeader("Authorization", auth);
      },
      success: function(data) {
        upload.uploadId = data.getElementsByTagName("UploadId")[0].innerHTML;
        this.uploadParts(upload);
      }
    });
  };

  this.sendFullFileToAmazon = function(upload){

    var auth = this.encryptAuth(upload.initSingleStr);
    $.ajax({
      xhr: function(){
        var xhr = $.ajaxSettings.xhr() ;
        xhr.upload.addEventListener("progress", upload.progressHandler);
        return xhr ;
      },
      url: 'https://' + upload.config.bucket + '.s3.amazonaws.com/'+ upload.awsObjURL,
      type: 'PUT',
      data: upload.file,
      context: this,
      contentType:'multipart/form-data',
      processData: false,
      beforeSend: function (xhr) {
        xhr.setRequestHeader("x-amz-date", upload.date);
        xhr.setRequestHeader("Authorization", auth);
      },
      success: function() {
        this.handler.successUploadCompleteHandler(this, upload)
      },
      fail: function(){
        upload.uploadFailed();
      }
    })
  };

  this.uploadParts = function(upload){
    for(var partNumber=1; partNumber <= upload.totalChunks; partNumber++){
      var part = new UploadPart(upload.file, partNumber, upload);
      upload.parts.push(part);
      this.sendPartToAmazon(part);
    }
  };

  this.completeMultipart = function(upload){
    var auth = this.encryptAuth(upload.finishMultiStr());
    var data = this.templateRenderer.renderXML(upload);

    $.ajax({
      url : 'https://' + upload.config.bucket + '.s3.amazonaws.com/'+upload.awsObjURL+'?uploadId='+upload.uploadId,
      type: 'POST',
      dataType: 'xml',
      data: data,
      contentType: false,
      context: this,
      beforeSend: function (xhr) {
        xhr.setRequestHeader("x-amz-date", upload.date);
        xhr.setRequestHeader("Authorization", auth);
      },
      success: function() {
        this.handler.successUploadCompleteHandler(this, upload)
      },
      fail: function() {
        this.handler.multiPartFailUploadHandler(upload)
      }
    })
  };

  this.sendPartToAmazon = function(part){
    var auth = this.encryptAuth(part.stringToSign());

    $.ajax({
      url: part.url(),
      type: 'PUT',
      dataType: 'xml',
      data: part.blob,
      contentType:'multipart/form-data',
      processData: false,
      beforeSend: function (xhr) {
        xhr.setRequestHeader("x-amz-date", part.upload.date);
        xhr.setRequestHeader("Authorization", auth);
      },
      context: this,
      success: function(data, textStatus, jqXHR) {
        this.handler.successPartUploadHandler(part, jqXHR, this.completeMultipart)
      },
      fail: function() {
        this.handler.multiPartFailUploadHandler(part.upload)
      }
    })
  };

  this.removeUpload = function(e){
    e.preventDefault();
    var upload = e.data.upload;
    upload.$el.remove();
    this.uploadQueue = _.without(this.uploadQueue, upload)
  };

  this.encryptAuth = function(stringToSign){
    var crypto = CryptoJS.HmacSHA1(stringToSign, this.config.secretKey).toString(CryptoJS.enc.Base64);
    return 'AWS'+' '+this.config.accessKey+':'+crypto
  };

  _.bindAll(this, "sendPartToAmazon", "removeUpload", "addUploadToView", "createUpload");
  _.bindAll(this, "getFile", "startUploads", "initiateMultipartUpload", "sendFullFileToAmazon");
  _.bindAll(this, "encryptAuth", "uploadParts", "completeMultipart");

  this.uploadForm.$fileInput.on('change', this.getFile);
  this.uploadForm.$container.on('drop', this.getFile);
  this.uploadForm.$el.on('submit', this.startUploads);

}
