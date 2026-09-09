<?php

	include("conexion2.php");

	$nombre = $_POST['nombre'];

	$query = "INSERT INTO usuario (Nombre) VALUES ('$nombre')";
	$resultado = $conexion->query($query);

	if($resultado){
		header("location: nuevo_suscriptor.php");
	}
	else{
		echo "Hubo problemas al insertar";
	}

?>