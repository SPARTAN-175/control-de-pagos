<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Home</title>
  <!--<link rel="stylesheet" href="/css/master.css">-->
  <link rel="stylesheet" type="text/css" href="css/Nuevo.css">
</head>

<body background="img/home.jpg">
    <div class="navegador">
      <div id="info">
        <h1>CAHESA</h1> <br>
      </div>
      <hr>
      <!--<img src="img/perfil.jpg" class="avatar" alt="Avatar Image">-->
      <form id="contenedor">
        <!-- USERNAME INPUT -->
        
          <div class="inputs">
            <a href="index.html">
            <img id="ico" src="img/home-automation.png">
            <span class="input">Hogar</span>
            </a>
          </div>
       
        
        <div class="inputs" style="background: rgba(166, 166, 166, .5); border-radius: 5px;">
          <a href="#">
            <img id="ico" src="img/anadir-grupo.png">
            <span class="input">Nuevo</span>
          </a>
        </div>
        
        <div class="inputs">
          <a href="#">
            <img id="ico" src="img/base-de-datos.png">
            <span class="input">Base De Datos</span>
          </a>
        </div>

        <div class="inputs">
          <a href="#">
            <img id="ico" src="img/tickets.png">
            <span class="input">Tickets</span>
          </a>
        </div>

      </form>

      <hr>

      <form id="contenedor">

        <!-- USERNAME INPUT -->
        
        <div class="inputs">
          <a href="#">
            <img id="ico" src="img/servidorrrrrrrrr.png">
            <span class="input">Servidor</span>
          </a>
        </div>

        <div class="inputs">
          <a href="#">
            <img id="ico" src="img/work-schedule.png">
            <span class="input">Historial</span>
          </a>
        </div>

        <div class="inputs">
          <a href="#">
            <img id="ico" src="img/carpeta.png">
            <span class="input">Mi Carpeta</span>  
          </a>
        </div>

        <div class="inputs">
          <a href="#">
            <img id="ico" src="img/ajustes.png">
            <span class="input">Configuración</span>
          </a>
        </div>

      </form>
    </div>


<!-- AQUI EMPIEZA LA TABLA DE REGISTRO DE NUEVOS SUSCRIPTORES-->
    <div class="tabla">
      
      <a href="home.html"><div class="cerrar">
        <button class="cerrar">X</button>
      </div></a>
      <!-- <tr> son filas y <td> son columnas-->
      <form action="validar_foto.php" method="POST" enctype="multipart/form-data" class="form">
      <!-- <tr> son filas y <td> son columnas-->
        <div class="lado_izquierdo">
          <tr>
            <td rowspan="9" class="foto">
             <img src="img/jefe.jpg" style="margin-left: 20px;" width="170px">
             <br>
             <label id="fotooo">Perfil</label>
             <input type="file" name="foto" id="fotoo"><br>
             <input type="submit" name="enviar" id="enviar"><br>
            </td><br>
          </tr>
        </div>
         <div class="lado_derecho">
           <tr>

            <!--<td>
             Nombre:<br>
             <input type="text" name="nombre" id="nombres" style=" width:100px; position: relative;"><br>
             <p style="position: absolute; margin-top: -60px; margin-left:175px">ID:</p><br>
              <input type="text"  name="id_sus" style=" width:20px; position: absolute; margin-top:-50px; margin-left:175px;">
            </td>-->
            <td>
             Suscripción:<br>
             <input type="text" name="suscripcion"><br>
            </td>
            <td>
              Fecha:<br>
              <input type="date"  name="fecha"><br>
            </td>
            <td>
              Pago Mensual:<br>
              <input type="number"  name="pago" style=" width:50px; position: relative;"><br>
              <p style="position: absolute; margin-top: -65px; margin-left:140px">Control:</p><br>
              <input type="text"  name="control" style=" width:50px; position: absolute; margin-top:-55px; margin-left:142px;">
            </td>
            <td>
              Proximo Pago:<br>
              <input type="date"  name="proximo_pago"><br>
            </td>
         </tr>
         </div>
      </form>

    </div>

    </div>
   
<!-- AQUI EMPIEZA VISTA PREVIA DE LOS DATOS-->
    <div class="vista_previa">
        <img src="img/ticket1.png" height="90%" style="margin-left: 29px; margin-top: 18px; position: absolute; display: block;" >
          <div id="label_ticket">
              <label class="inp_ticket"><b>Pagaste un servicio</b></label> <br>
              <label class="inp_ticket1"><b>$100.00</b></label><br>
              <label class="inp_ticket2">05/Ene/2023</label><br>
              <label class="inp_ticket3">Concepto</label><br>
              <label class="inp_ticket4">Servicio de internet</label><br>
              <label class="inp_ticket5">Carlos Arturo Hernández S.</label><br>
              <label class="inp_ticket6">Su próximi pago es</label><br>
              <label class="inp_ticket7">05/Feb/2023</label><br>
              <label class="inp_ticket8">ID-001</label>
          </div>
    </div>
<!-- AQUI MPIEZA EL ICONO DEL USUARIO Y EL BOTON DE CERRAR SESION-->
<!-- AQUI EMPIEZA EL BUSCADOR-->






</body>

</html>