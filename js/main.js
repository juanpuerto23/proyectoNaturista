document.getElementById('loginForm').addEventListener('submit', function (event) {
    event.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value; 
    // Simulación de autenticación
    if (username === 'usuario' && password === 'contraseña') {  // Cambia a los valores que necesites
        localStorage.setItem('isAuthenticated', 'true');  // Guardamos el estado de autenticación
        window.location.href = 'menu.html';  // Redirigimos al menú
    } else {
        // Mostrar mensaje de error si las credenciales son incorrectas
        const errorMessage = document.getElementById('error-message');
        errorMessage.style.display = 'block';
        errorMessage.textContent = 'Usuario o contraseña incorrectos. Por favor, intenta de nuevo.';
    }
});



