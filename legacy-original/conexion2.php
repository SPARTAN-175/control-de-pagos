<?php

$conexion = new mysqli("localhost","root","","control_de_pagos");

if($conexion){

} else{
	echo "hubo un problema en la conexion";
}

?>