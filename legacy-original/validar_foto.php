<?php

	include("conexion2.php");

	$imagen = addslashes(file_get_contents($_FILES['foto']['tmp_name']));
	$suscripcion = $_POST['suscripcion'];
	$control = $_POST['control'];
	$fecha = $_POST['fecha'];
	$proximo_pago = $_POST['proximo_pago'];
	$pago = $_POST['pago'];
	$nombre = $_POST['id_sus];

	$query = "INSERT INTO suscriptores (ID_Suscriptor, Foto_Perfil, Suscripcion, Num_Pagos, Fecha_Pago, Fecha_Prox_Pago, Monto) VALUES ('$imagen','$suscripcion','$control', '$fecha','$proximo_pago','pago')";
	$resultado = $conexion->query($query);

	if($resultado){
		header("location: nuevo_suscriptor.html");
	}
	else{
		echo "Hubo problemas al insertar";
	}

?>