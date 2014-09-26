s3-js-file-uploader
===================

Upload multipart or single part files directly to s3

# Features
Written in pure javascript, so upload is async and on client side.
Ability to upload files up to 2TB using amazon s3 multipart upload.
No need for database.
Uses CORS
Flexibility to change handlers for upload success.


Dependencies
------
* Jquery
* [underscore.js](http://underscorejs.org/)
* [CryptoJS hmac-sha1.js](http://crypto-js.googlecode.com/svn/tags/3.1.2/build/rollups/hmac-sha1.js)
* [CryptoJS enc-base64-min.js](http://crypto-js.googlecode.com/svn/tags/3.1.2/build/components/enc-base64-min.js)

Extras used in example
------
* bootstrap
* basic css
* font awesome

Example Usage
------

Download and require s3-js-file-uploader.js or download each component separately.

Copy the following basic upload form

```
.container.upload-container
  %h2
    Drag & Drop a File
  %h2
    Or select an option below
  %form#upload-form
    .row
      %span.btn.btn-success.fileinput-button
        %i.fa.fa-plus.fa-4x
        %p Select files...
        %input#fileupload{multiple: "multiple", name: "files[]", type: "file"}
      %button.btn.btn-primary.start{type: "submit"}
        %i.fa.fa-upload.fa-4x
        %p Start upload
    .row
      %table.upload-table.full-width.table-striped
        %thead
          %tr
            %th{class:"col-md-2"} File Name
            %th{class:"col-md-1"} File Size
            %th{class:"col-md-1"} Progress
            %th{class:"col-md-1"} Delete
        %tbody
```
---

Create a template that will fill the tbody of the table as an upload is added.
```
%script{:id => "upload-template", :type => "text/template"}
  %tr{:class=> 'upload-{{fileNumber}}'}
    %td.col-md-2 {{ file.name }}
    %td.col-md-1 {{ (file.size/1024/1024).toFixed(2) }} MB
    %td.col-md-1
      .progress.progress-striped.active.mts
        .progress-bar
          %span.sr-only
          %span.status
    %td
      %span.btn.btn-danger.delete-upload
        %i.fa.fa-times
```
---

Lastly, in javascript, create a Config object with (maxFileSize, bucket, accessKey, secretKey, folderName) as parameters.
Then create the uploader.

```
  config = new Config(maxFileSize, bucket, accessKey, secretKey, folderName)
  new Uploader(config);
```

Important Amazon Setup
------
* Bucket must be all lower case
* CORS setup in Amazon bucket should be similar to
```
  <?xml version="1.0" encoding="UTF-8"?>
  <CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
      <CORSRule>
          <AllowedOrigin>*</AllowedOrigin>
          <AllowedMethod>GET</AllowedMethod>
          <AllowedMethod>POST</AllowedMethod>
          <AllowedMethod>PUT</AllowedMethod>
          <AllowedMethod>DELETE</AllowedMethod>
          <MaxAgeSeconds>3000</MaxAgeSeconds>
          <ExposeHeader>ETag</ExposeHeader>
          <AllowedHeader>*</AllowedHeader>
      </CORSRule>
  </CORSConfiguration>
```
* 1000 max parts for multipart. Change multipart min size accordingly to the size of your uploads.

Editing handlers
------
If you want something to occur after an upload is successful, you can change the success handler.
```
var handlerOptions = {
  allUploadsFinishedHandler: function(){
    console.log('all uploads are done')
  },
  customSuccessPartHandler: function(){
    console.log('A part of the upload is done')
  },
  this.customSuccessHandler = function(){
    console.log('This upload finished')
  };
}

new Uploader(config, handlerOptions);
```

