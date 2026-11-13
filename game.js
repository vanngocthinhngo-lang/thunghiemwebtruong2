// --- 1. SỬA LỖI VỪA CHẠY VỪA BẮN ---
// Trong vòng lặp render/update của game, tách biệt di chuyển và đạn bay:
function updateGame() {
    // Cập nhật di chuyển (không bị if else chặn bởi hành động bắn)
    if (keys['w']) moveForward();
    if (keys['s']) moveBackward();
    if (keys['a']) moveLeft();
    if (keys['d']) moveRight();
    
    // Cập nhật vị trí các viên đạn độc lập
    updateBullets(); 
    
    requestAnimationFrame(updateGame);
}

// Sự kiện click chuột để bắn
window.addEventListener('mousedown', () => {
    fireBullet(); 
});


// --- 2. LÀM VIÊN ĐẠN TRÔNG CHÂN THẬT HƠN (DÀNH CHO THREE.JS) ---
function fireBullet() {
    // Dùng CylinderGeometry để tạo hình trụ thon dài thay vì BoxGeometry (khối vuông)
    const bulletGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8);
    bulletGeo.rotateX(Math.PI / 2); // Xoay viên đạn hướng tới trước
    
    // Dùng MeshBasicMaterial màu cam sáng (0xffaa00) để đạn luôn sáng không bị tối do thiếu đèn
    const bulletMat = new THREE.MeshBasicMaterial({ 
        color: 0xffaa00 
    });
    
    const bullet = new THREE.Mesh(bulletGeo, bulletMat);
    
    // --- Code cũ của bạn bên dưới (set position, quaternion, add vào scene...) ---
    // bullet.position.copy(player.position);
    // ...
}
