<?php
$n="http://127.0.0.1:3000";
$t=$n.$_SERVER["REQUEST_URI"];
$c=curl_init($t);
curl_setopt($c,CURLOPT_RETURNTRANSFER,true);
curl_setopt($c,CURLOPT_FOLLOWLOCATION,false);
curl_setopt($c,CURLOPT_TIMEOUT,30);
curl_setopt($c,CURLOPT_CUSTOMREQUEST,$_SERVER["REQUEST_METHOD"]);
$h=[];
foreach(getallheaders() as $k=>$v){if(strtolower($k)!=="host")$h[]="$k: $v";}
$h[]="X-Forwarded-Host: ".($_SERVER["HTTP_HOST"]??"");
$h[]="X-Forwarded-For: ".($_SERVER["REMOTE_ADDR"]??"");
curl_setopt($c,CURLOPT_HTTPHEADER,$h);
if(in_array($_SERVER["REQUEST_METHOD"],["POST","PUT","PATCH"])){
  curl_setopt($c,CURLOPT_POSTFIELDS,file_get_contents("php://input"));
}
$r=curl_exec($c);
$code=curl_getinfo($c,CURLINFO_HTTP_CODE);
$ct=curl_getinfo($c,CURLINFO_CONTENT_TYPE);
curl_close($c);
http_response_code($code);
if($ct)header("Content-Type: ".$ct);
echo $r;
