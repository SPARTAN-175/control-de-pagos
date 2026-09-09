<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Home</title>
  <!--<link rel="stylesheet" href="/css/master.css">-->
  <link rel="stylesheet" type="text/css" href="css/homephp.css">
</head>

<body background="img/home.jpg">


<!-- AQUI EMPIEZA LA TABLA DE LOS DATOS-->

    <div class="tabla">
      <!-- <tr> son filas y <td> son columnas-->
      <form action="validar_foto.php" method="POST" enctype="multipart/form-data">
         <div class="resalta_tabla">

           <tr>
                <td rowspan="2" class="foto">
                <img src="<?php echo substr($mostrar['Foto_Perfil'],3) ?>">
                </td>
                <td class="nombre">
                <?php echo $mostrar['Nombre'] ?>
                </td>
         </tr>
         <tr>
                <td class="suscripcion">

                </td>
                <td class="mensual">
                <?php echo $mostrar['Suscripcion'] ?>
                </td>
                <td class="cien">
                <?php echo $mostrar['Pago'] ?>
                </td>
         </tr>
         <?php
        

        ?>
         </div>
      </form>

    </div>






</body>

</html>