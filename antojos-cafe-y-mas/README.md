# Antojos, Café y Más — menú, pedidos por WhatsApp y panel de administración

Sitio web para el café, con un panel privado (`/admin`) donde puedes:

- agregar, editar y eliminar productos, con foto
- marcar productos como **agotados** u ocultarlos
- poner **promos** (precio rebajado en un producto o anuncios con etiqueta)
- cambiar **precios**
- crear, renombrar, ordenar y ocultar **categorías**
- definir el **horario** y cerrar el negocio cuando quieras (feriados, vacaciones)
- cambiar el **WhatsApp** que recibe los pedidos, el nombre, la dirección y el mensaje de pedido

Los clientes eligen sus productos y el sitio abre **WhatsApp con el pedido ya escrito** hacia tu número. El cliente solo toca “Enviar”.

> Todo lo que cambies en el panel se guarda en una base de datos (Upstash Redis, gratis) y se ve en el sitio en unos segundos. No hay que volver a subir nada a GitHub para cambiar el menú.

---

## Paso a paso para publicarlo

### 1. Subir a GitHub

1. Crea un repositorio nuevo en GitHub (puede ser privado).
2. Sube **el contenido** de esta carpeta (las carpetas `api`, `lib`, `public` y los archivos `vercel.json`, `package.json`, `README.md`), **no la carpeta que las contiene**. Así `api/` y `public/` quedan en la raíz del repositorio.
   - Desde la web de GitHub: **Add file → Upload files**, arrastra el contenido y confirma con **Commit changes**.

### 2. Importarlo en Vercel

1. En [vercel.com](https://vercel.com) entra a **Add New → Project** e importa el repositorio.
2. No cambies ninguna configuración (no necesita comando de build). Pulsa **Deploy**.
3. Cuando termine, el sitio ya funciona con el menú de ejemplo (productos sin precio aparecen como “Consultar”).

### 3. Conectar la base de datos (para que el panel pueda guardar)

1. En tu proyecto de Vercel abre la pestaña **Storage → Create Database** y elige **Upstash → Redis**.
2. Crea la base (plan gratuito) y, cuando lo pida, **conéctala a tu proyecto** (marca Production, Preview y Development).
   - Vercel agrega solo las variables `KV_REST_API_URL` y `KV_REST_API_TOKEN`.
   - Si prefieres crearla directamente en upstash.com, copia su **REST URL** y **REST TOKEN** y guárdalos en **Settings → Environment Variables** con esos mismos nombres.

### 4. Crear la contraseña del panel

1. En **Settings → Environment Variables** crea la variable `ADMIN_PASSWORD` con la contraseña que quieras (mínimo 6 caracteres; mejor una larga).
2. Ve a **Deployments**, abre el menú `⋯` del último despliegue y elige **Redeploy**. (Las variables nuevas solo se aplican a despliegues nuevos.)

### 5. Entrar al panel

Abre `https://TU-SITIO.vercel.app/admin`, escribe la contraseña y listo.

**Atajo desde el celular:** en el sitio público, toca **dos veces seguidas el logo** (el círculo de arriba a la izquierda) y se abre el panel. Una vez que entras con la contraseña, el celular la recuerda por 30 días y el atajo te lleva directo, sin escribirla otra vez.

Si algo falta, el panel te lo dice:

| Mensaje | Qué hacer |
| --- | --- |
| “Falta crear la contraseña” | Paso 4 |
| “La contraseña es muy corta” | Usa 6 caracteres o más y redespliega |
| Aviso amarillo “la base de datos todavía no está conectada” | Paso 3 y redespliegue. Mientras tanto, lo que cambies solo se guarda en ese navegador y tus clientes no lo ven |

---

## Cómo se usa el panel

- **Productos**: toca un producto para editar nombre, descripción, categoría, precio, foto, promo, agotado u ocultar. El interruptor “Agotado” de cada fila lo cambia al instante. “Ordenar” permite subir y bajar productos dentro de su categoría.
- **Categorías**: crea, cambia el nombre (escribiendo encima), elige su ícono (toca el círculo de la izquierda; hay 25 de comida y bebida), ordena u oculta. Una categoría con productos no se puede eliminar hasta moverlos o borrarlos.
- **Promos**: anuncios que aparecen arriba del menú. Puedes enlazarlos a un producto para que el cliente lo pida con un toque, ponerles fecha de vencimiento y pausarlos. El **precio de promo de un producto** se activa dentro del propio producto (“En promoción”), con etiqueta y fecha opcional.
- **Horario**: tres modos. *Automático* (abre y cierra solo según el horario, hora de Costa Rica), *Abierto siempre* o *Cerrado ahora* (con mensaje para tus clientes). También puedes dejar que reciban pedidos aunque estés cerrado.
- **Ajustes**: nombre, número de WhatsApp, dirección, titular de la portada, primera línea del mensaje de pedido, respaldo y cierre de sesión.

Cada cambio se guarda solo (arriba aparece “Guardando…” y luego “Guardado”). No hay botón de publicar.

### Datos que debes completar tú

El sitio sale con valores de ejemplo para no inventar nada:

- **Precios**: todos los productos empiezan sin precio (el sitio muestra “Consultar” y el pedido no suma total). Ponles precio desde el panel.
- **Número de WhatsApp**: viene como **+506 7066 8903** (el del logo). Cámbialo en Ajustes si no es el correcto.
- **Dirección y horario**: vienen vacíos. El sitio arranca en “Abierto siempre”.
- **Fotos**: los productos de ejemplo usan ilustraciones. Sube tus fotos reales: se recortan al centro en formato 4:3 y se comprimen solas.

### Cómo llegan los pedidos

Al enviar, el sitio abre WhatsApp en el chat de tu número con un mensaje como:

```
¡Hola! Quiero hacer un pedido en Antojos, Café y Más:

• 2 × Café — ₡3 000
• 1 × Latte (promo) — ₡1 500

Total: ₡4 500

Nombre: María
Notas: Sin azúcar
```

El pedido no llega a ningún servidor: es el cliente quien lo envía desde su WhatsApp. Por eso no verás pedidos “pendientes” en el panel; los verás en tu WhatsApp.

---

## Preguntas frecuentes

**¿Por qué no veo el cambio de inmediato en el sitio?**
El menú se guarda en cuanto cambias algo, pero el sitio puede tardar unos segundos (hasta ~1 minuto) en mostrarlo por la caché. Recarga la página.

**Me sale “Otro dispositivo cambió el menú”.**
Dos personas (o dos pantallas) editaron al mismo tiempo. Pulsa **Recargar** para ver lo más reciente y repite tu cambio. Así nadie pisa el trabajo del otro.

**Olvidé la contraseña / quiero cambiarla.**
Cámbiala en Vercel (`ADMIN_PASSWORD`) y redespliega. Al cambiarla se cierran todas las sesiones abiertas.

**Quiero hacer una copia de seguridad.**
**Ajustes → Descargar respaldo** baja un archivo con todo el menú (incluye las fotos). **Restaurar respaldo** lo vuelve a cargar.

**Al abrir el sitio me pide iniciar sesión en Vercel.**
Es la “Deployment Protection” de Vercel. En **Settings → Deployment Protection** desactiva *Vercel Authentication* (al menos para Production) y el sitio queda público para tus clientes.

**¿Qué pasa si la base de datos se cae?**
El sitio sigue abierto, pero mientras dure la caída los clientes ven el menú de ejemplo (sin tus cambios recientes) y el panel avisa que no puede guardar. Al volver la base de datos todo reaparece tal como lo dejaste: no se pierde nada.

**¿Hay límites?**
Hasta 30 categorías, 300 productos y 20 promos. El plan gratuito de Upstash alcanza de sobra para un menú; revisa sus límites vigentes en upstash.com.

**¿Cómo cambio colores, textos fijos o el logo?**
Los textos fijos están en `public/index.html`, los colores en `public/css/site.css` y el logo en `public/assets/`. Son cambios de código: se editan en GitHub y Vercel los publica solo.

**Para que el enlace salga con imagen al compartirlo por WhatsApp (opcional).**
En `public/index.html` cambia la línea `og:image` por la dirección completa de tu sitio, por ejemplo `https://TU-SITIO.vercel.app/assets/og-image.png`.

---

## Seguridad

- El panel pide contraseña y la verifica en el servidor. La contraseña nunca se guarda en la base de datos ni en el navegador; el navegador guarda solo una llave de sesión que vence a los 30 días.
- Se bloquean los intentos repetidos de entrar con contraseña incorrecta (unos 15 minutos).
- Solo con sesión iniciada se puede guardar el menú o subir fotos; el servidor revisa y limpia todo lo que recibe.
- Las páginas llevan cabeceras de seguridad (ver `vercel.json`) y `/admin` no se indexa en buscadores.
- No pongas la contraseña en el código ni en GitHub: va solo en las variables de entorno de Vercel.

## Probarlo en tu computadora (opcional)

Necesitas Node 18 o más y la CLI de Vercel:

```
npm i -g vercel
vercel link
vercel env pull .env.local
vercel dev
```

Se abre en `http://localhost:3000` (el panel en `/admin`).

## Estructura

```
api/       funciones del servidor (menú, acceso, subida y entrega de fotos)
lib/       código compartido (base de datos, sesión, validación del menú)
public/    el sitio: index.html, admin.html, css/, js/, assets/, data/menu.default.json
vercel.json  configuración y cabeceras de seguridad
```
