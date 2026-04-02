// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyCBi6GCigBZx5yRTTTW8SXHzSkA1uTAvpM",
    authDomain: "billingsol-e9a83.firebaseapp.com",
    databaseURL: "https://billingsol-e9a83-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "billingsol-e9a83",
    storageBucket: "billingsol-e9a83.firebasestorage.app",
    messagingSenderId: "436716611232",
    appId: "1:436716611232:web:e185ad817d4a67d0f94bc5",
    measurementId: "G-7RG9H1C0BM"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const database = firebase.database();

// Application State
let products = [];
let billItems = [];
let invoiceCounter = 1;
let taxRate = 18; // Default tax rate in percentage
let discountType = 'percentage'; // 'percentage' or 'fixed'
let discountValue = 0;
let heldBills = []; // Store held bills
let currentBill = {
    invoiceNumber: 'INV-001',
    date: new Date().toLocaleDateString(),
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    paymentMode: 'Cash',
    items: [],
    subtotal: 0,
    discount: 0,
    tax: 0,
    total: 0,
    notes: ''
};

// User Management State
let currentUser = null;
let users = [];

// Shop Settings
let shopSettings = {
    shopName: 'Your Store Name',
    shopAddress: '',
    shopPhone: '',
    shopEmail: '',
    shopGST: '',
    shopPAN: '',
    invoicePrefix: 'INV',
    defaultTaxRate: 18,
    invoiceFooter: 'Thank you for your business!',
    bankName: '',
    accountNumber: '',
    ifscCode: '',
    autoSaveTransactions: false
};

let db; // IndexedDB database reference

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
    await initializeDB();
    loadSettings();
    loadHeldBills();
    
    // Check for existing user session
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            // Verify user still exists and is active
            const user = await getUserByUsername(currentUser.username);
            if (user && user.isActive) {
                currentUser = user;
                showMainApp();
            } else {
                localStorage.removeItem('currentUser');
                currentUser = null;
            }
        } catch (error) {
            console.error('Error loading user session:', error);
            localStorage.removeItem('currentUser');
            currentUser = null;
        }
    }
    
    // Load all users for admin functionality
    try {
        users = await getAllUsers();
    } catch (error) {
        console.error('Error loading users:', error);
        users = [];
    }
    
    initializeEventListeners();
});

// ============== INDEXEDDB INITIALIZATION ==============

async function initializeDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('BillingInventoryDB', 2);
        
        request.onerror = () => {
            console.error('Database failed to open');
            reject('Database failed to open');
        };
        
        request.onsuccess = () => {
            db = request.result;
            console.log('Database opened successfully');
            resolve();
        };
        
        request.onupgradeneeded = (event) => {
            db = event.target.result;
            
            // Create Products Store
            if (!db.objectStoreNames.contains('products')) {
                const productStore = db.createObjectStore('products', { keyPath: 'id' });
                productStore.createIndex('name', 'name', { unique: false });
                productStore.createIndex('userId', 'userId', { unique: false });
            }
            
            // Create Bills Store
            if (!db.objectStoreNames.contains('bills')) {
                const billStore = db.createObjectStore('bills', { keyPath: 'id', autoIncrement: true });
                billStore.createIndex('invoiceNumber', 'invoiceNumber', { unique: true });
                billStore.createIndex('date', 'savedAt', { unique: false });
                billStore.createIndex('userId', 'userId', { unique: false });
            }
            
            // Create Metadata Store (for invoice counter)
            if (!db.objectStoreNames.contains('metadata')) {
                db.createObjectStore('metadata', { keyPath: 'key' });
            }
            
            // Create Users Store
            if (!db.objectStoreNames.contains('users')) {
                const userStore = db.createObjectStore('users', { keyPath: 'id' });
                userStore.createIndex('username', 'username', { unique: true });
                userStore.createIndex('email', 'email', { unique: false });
            }
            
            console.log('Database schema created');
        };
    });
}

// ============== USER AUTHENTICATION ==============

function showLoginForm() {
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
}

function showRegisterForm() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
}

async function handleLogin(event) {
    event.preventDefault();
    
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    if (!username || !password) {
        showAlert('Please enter username and password', 'error');
        return;
    }
    
    try {
        const user = await authenticateUser(username, password);
        if (user) {
            currentUser = user;
            localStorage.setItem('currentUser', JSON.stringify(user));
            showMainApp();
            showAlert(`Welcome back, ${user.fullName}!`, 'success');
        } else {
            showAlert('Invalid username or password', 'error');
        }
    } catch (error) {
        console.error('Login error:', error);
        showAlert('Login failed. Please try again.', 'error');
    }
}

async function handleRegister(event) {
    event.preventDefault();
    
    const username = document.getElementById('registerUsername').value.trim();
    const fullName = document.getElementById('registerFullName').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('registerConfirmPassword').value;
    
    if (!username || !fullName || !password) {
        showAlert('Please fill in all required fields', 'error');
        return;
    }
    
    if (password !== confirmPassword) {
        showAlert('Passwords do not match', 'error');
        return;
    }
    
    if (password.length < 6) {
        showAlert('Password must be at least 6 characters', 'error');
        return;
    }
    
    try {
        // Check if username already exists
        const existingUser = await getUserByUsername(username);
        if (existingUser) {
            showAlert('Username already exists', 'error');
            return;
        }
        
        // Create user with Firebase Authentication
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const firebaseUser = userCredential.user;
        
        // Create new user object (without password - Firebase Auth handles that)
        const newUser = {
            username: username,
            fullName: fullName,
            email: email,
            role: users.length === 0 ? 'admin' : 'user', // First user is admin
            createdAt: new Date().toLocaleString('en-IN'),
            isActive: true,
            firebaseUid: firebaseUser.uid
        };
        
        // Save user data to Firebase Realtime Database
        const userId = await saveUser(newUser);
        newUser.id = userId;
        users.push(newUser);
        
        // Auto-login after registration
        currentUser = newUser;
        localStorage.setItem('currentUser', JSON.stringify(newUser));
        showMainApp();
        showAlert(`Registration successful! Welcome, ${newUser.fullName}!`, 'success');
    } catch (error) {
        console.error('Registration error:', error);
        let errorMessage = 'Registration failed. Please try again.';
        if (error.code === 'auth/email-already-in-use') {
            errorMessage = 'Email already in use';
        } else if (error.code === 'auth/weak-password') {
            errorMessage = 'Password is too weak';
        } else if (error.code === 'auth/invalid-email') {
            errorMessage = 'Invalid email address';
        }
        showAlert(errorMessage, 'error');
    }
}

function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
        currentUser = null;
        localStorage.removeItem('currentUser');
        document.getElementById('mainApp').style.display = 'none';
        document.getElementById('authScreen').style.display = 'flex';
        document.getElementById('loginUsername').value = '';
        document.getElementById('loginPassword').value = '';
        showAlert('Logged out successfully', 'success');
    }
}

function showMainApp() {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    updateUserInfo();
    loadUserData();
}

function updateUserInfo() {
    if (currentUser) {
        document.getElementById('currentUserName').textContent = currentUser.fullName;
        document.getElementById('currentUserRole').textContent = currentUser.role === 'admin' ? 'Admin' : 'User';
        
        // Show user management button for admins
        const userMgmtBtn = document.getElementById('userMgmtBtn');
        if (currentUser.role === 'admin') {
            userMgmtBtn.style.display = 'flex';
        } else {
            userMgmtBtn.style.display = 'none';
        }
    }
}

async function loadUserData() {
    // Load user-specific data
    await loadData();
    renderProducts();
    updateInventoryDashboard();
    renderBillItems();
    updateBillProductSelect();
}

// ============== USER DATABASE OPERATIONS ==============

async function authenticateUser(username, password) {
    try {
        // First, get user data from Firebase Realtime Database
        const userRef = database.ref('users');
        const snapshot = await userRef.orderByChild('username').equalTo(username).once('value');
        const userData = snapshot.val();
        
        if (!userData) {
            return null;
        }
        
        // Get the first (and should be only) user with this username
        const userId = Object.keys(userData)[0];
        const user = userData[userId];
        
        if (!user.isActive) {
            return null;
        }
        
        // Authenticate with Firebase Auth using email
        const userCredential = await auth.signInWithEmailAndPassword(user.email, password);
        
        if (userCredential.user) {
            return { ...user, id: userId };
        }
        
        return null;
    } catch (error) {
        console.error('Authentication error:', error);
        return null;
    }
}

async function getUserByUsername(username) {
    try {
        const userRef = database.ref('users');
        const snapshot = await userRef.orderByChild('username').equalTo(username).once('value');
        const userData = snapshot.val();
        
        if (!userData) {
            return null;
        }
        
        // Get the first (and should be only) user with this username
        const userId = Object.keys(userData)[0];
        return { ...userData[userId], id: userId };
    } catch (error) {
        console.error('Error getting user by username:', error);
        throw error;
    }
}

async function saveUser(user) {
    try {
        const userRef = database.ref('users');
        const newUserRef = userRef.push();
        await newUserRef.set(user);
        return newUserRef.key;
    } catch (error) {
        console.error('Error saving user:', error);
        throw error;
    }
}

async function getAllUsers() {
    try {
        const userRef = database.ref('users');
        const snapshot = await userRef.once('value');
        const usersData = snapshot.val();
        
        if (!usersData) {
            return [];
        }
        
        // Convert object to array with IDs
        return Object.keys(usersData).map(key => ({
            ...usersData[key],
            id: key
        }));
    } catch (error) {
        console.error('Error getting all users:', error);
        throw error;
    }
}

async function updateUser(user) {
    try {
        const userRef = database.ref('users/' + user.id);
        await userRef.update(user);
    } catch (error) {
        console.error('Error updating user:', error);
        throw error;
    }
}

async function deleteUser(userId) {
    try {
        const userRef = database.ref('users/' + userId);
        await userRef.remove();
    } catch (error) {
        console.error('Error deleting user:', error);
        throw error;
    }
}

function hashPassword(password) {
    // Simple hash function for demo purposes
    // In production, use a proper hashing library
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
        const char = password.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString();
}

// ============== USER MANAGEMENT MODAL ==============

function openUserManagementModal() {
    if (currentUser.role !== 'admin') {
        showAlert('Access denied. Admin privileges required.', 'error');
        return;
    }
    
    const modal = document.getElementById('userManagementModal');
    modal.classList.add('show');
    loadUsersList();
}

function closeUserManagementModal() {
    const modal = document.getElementById('userManagementModal');
    modal.classList.remove('show');
}

async function loadUsersList() {
    const usersList = document.getElementById('usersList');
    
    try {
        const allUsers = await getAllUsers();
        users = allUsers;
        
        if (allUsers.length === 0) {
            usersList.innerHTML = '<p class="empty-state">No users found</p>';
            return;
        }
        
        usersList.innerHTML = allUsers.map(user => `
            <div class="user-item">
                <div class="user-details">
                    <div class="user-name">${user.fullName}</div>
                    <div class="user-meta">
                        <span>@${user.username}</span>
                        ${user.email ? ` • ${user.email}` : ''}
                        • Created: ${user.createdAt}
                    </div>
                </div>
                <div class="user-actions">
                    <span class="role-badge ${user.role === 'admin' ? 'role-admin' : 'role-user'}">
                        ${user.role === 'admin' ? 'Admin' : 'User'}
                    </span>
                    ${user.id !== currentUser.id ? `
                        <button class="btn btn-warning" onclick="toggleUserStatus(${user.id})" style="width: auto; padding: 6px 12px;">
                            ${user.isActive ? '🔒' : '🔓'}
                        </button>
                        <button class="btn btn-danger" onclick="deleteUserById(${user.id})" style="width: auto; padding: 6px 12px;">
                            🗑️
                        </button>
                    ` : '<span style="color: #6b7280; font-size: 0.85rem;">(You)</span>'}
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading users:', error);
        usersList.innerHTML = '<p class="empty-state">Error loading users</p>';
    }
}

async function handleAddUser(event) {
    event.preventDefault();
    
    const username = document.getElementById('newUsername').value.trim();
    const fullName = document.getElementById('newFullName').value.trim();
    const email = document.getElementById('newEmail').value.trim();
    const password = document.getElementById('newPassword').value;
    const role = document.getElementById('newRole').value;
    
    if (!username || !fullName || !password) {
        showAlert('Please fill in all required fields', 'error');
        return;
    }
    
    try {
        // Check if username already exists
        const existingUser = await getUserByUsername(username);
        if (existingUser) {
            showAlert('Username already exists', 'error');
            return;
        }
        
        // Create new user
        const newUser = {
            id: Date.now(),
            username: username,
            fullName: fullName,
            email: email,
            password: hashPassword(password),
            role: role,
            createdAt: new Date().toLocaleString('en-IN'),
            isActive: true
        };
        
        await saveUser(newUser);
        users.push(newUser);
        
        // Reset form
        document.getElementById('addUserForm').reset();
        
        // Reload users list
        await loadUsersList();
        
        showAlert(`User ${username} created successfully!`, 'success');
    } catch (error) {
        console.error('Error adding user:', error);
        showAlert('Error creating user', 'error');
    }
}

async function toggleUserStatus(userId) {
    try {
        const user = users.find(u => u.id === userId);
        if (user) {
            user.isActive = !user.isActive;
            await updateUser(user);
            await loadUsersList();
            showAlert(`User ${user.username} ${user.isActive ? 'activated' : 'deactivated'}`, 'success');
        }
    } catch (error) {
        console.error('Error toggling user status:', error);
        showAlert('Error updating user status', 'error');
    }
}

async function deleteUserById(userId) {
    if (confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
        try {
            await deleteUser(userId);
            users = users.filter(u => u.id !== userId);
            await loadUsersList();
            showAlert('User deleted successfully', 'success');
        } catch (error) {
            console.error('Error deleting user:', error);
            showAlert('Error deleting user', 'error');
        }
    }
}

// ============== SETTINGS MANAGEMENT ==============

function openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    loadSettingsToForm();
    modal.classList.add('show');
}

function closeSettingsModal() {
    const modal = document.getElementById('settingsModal');
    modal.classList.remove('show');
}

function loadSettingsToForm() {
    document.getElementById('shopName').value = shopSettings.shopName || '';
    document.getElementById('shopAddress').value = shopSettings.shopAddress || '';
    document.getElementById('shopPhone').value = shopSettings.shopPhone || '';
    document.getElementById('shopEmail').value = shopSettings.shopEmail || '';
    document.getElementById('shopGST').value = shopSettings.shopGST || '';
    document.getElementById('shopPAN').value = shopSettings.shopPAN || '';
    document.getElementById('invoicePrefix').value = shopSettings.invoicePrefix || 'INV';
    document.getElementById('defaultTaxRate').value = shopSettings.defaultTaxRate || 18;
    document.getElementById('invoiceFooter').value = shopSettings.invoiceFooter || 'Thank you for your business!';
    document.getElementById('bankName').value = shopSettings.bankName || '';
    document.getElementById('accountNumber').value = shopSettings.accountNumber || '';
    document.getElementById('ifscCode').value = shopSettings.ifscCode || '';
    document.getElementById('autoSaveTransactions').checked = shopSettings.autoSaveTransactions || false;
}

function saveSettings() {
    shopSettings.shopName = document.getElementById('shopName').value.trim() || 'Your Store Name';
    shopSettings.shopAddress = document.getElementById('shopAddress').value.trim();
    shopSettings.shopPhone = document.getElementById('shopPhone').value.trim();
    shopSettings.shopEmail = document.getElementById('shopEmail').value.trim();
    shopSettings.shopGST = document.getElementById('shopGST').value.trim();
    shopSettings.shopPAN = document.getElementById('shopPAN').value.trim();
    shopSettings.invoicePrefix = document.getElementById('invoicePrefix').value.trim() || 'INV';
    shopSettings.defaultTaxRate = parseFloat(document.getElementById('defaultTaxRate').value) || 18;
    shopSettings.invoiceFooter = document.getElementById('invoiceFooter').value.trim() || 'Thank you for your business!';
    shopSettings.bankName = document.getElementById('bankName').value.trim();
    shopSettings.accountNumber = document.getElementById('accountNumber').value.trim();
    shopSettings.ifscCode = document.getElementById('ifscCode').value.trim();
    shopSettings.autoSaveTransactions = document.getElementById('autoSaveTransactions').checked;
    
    // Update tax rate if changed
    taxRate = shopSettings.defaultTaxRate;
    document.getElementById('taxSlider').value = taxRate;
    document.getElementById('taxPercentageDisplay').textContent = taxRate;
    document.getElementById('taxPercentageLabel').textContent = taxRate;
    
    // Save to localStorage
    localStorage.setItem('shopSettings', JSON.stringify(shopSettings));
    
    showAlert('Settings saved successfully!', 'success');
    closeSettingsModal();
}

function loadSettings() {
    const saved = localStorage.getItem('shopSettings');
    if (saved) {
        shopSettings = JSON.parse(saved);
        taxRate = shopSettings.defaultTaxRate || 18;
    }
}

function resetSettings() {
    if (confirm('Are you sure you want to reset all settings to default?')) {
        shopSettings = {
            shopName: 'Your Store Name',
            shopAddress: '',
            shopPhone: '',
            shopEmail: '',
            shopGST: '',
            shopPAN: '',
            invoicePrefix: 'INV',
            defaultTaxRate: 18,
            invoiceFooter: 'Thank you for your business!',
            bankName: '',
            accountNumber: '',
            ifscCode: '',
            autoSaveTransactions: false
        };
        loadSettingsToForm();
        showAlert('Settings reset to default!', 'success');
    }
}

// Event Listeners
function initializeEventListeners() {
    // Product Form
    document.getElementById('productForm').addEventListener('submit', addProduct);
    
    // Bill Actions
    document.getElementById('addToBillBtn').addEventListener('click', addToBill);
    document.getElementById('printBillBtn').addEventListener('click', printInvoice);
    document.getElementById('saveBillBtn').addEventListener('click', saveBill);
    document.getElementById('newBillBtn').addEventListener('click', createNewBill);
    document.getElementById('viewBillsBtn').addEventListener('click', openSavedBillsModal);
    document.getElementById('printLastBillBtn').addEventListener('click', printLastSavedBill);
    document.getElementById('exportDataBtn').addEventListener('click', exportData);
    document.getElementById('clearDataBtn').addEventListener('click', clearDatabase);
    
    // Customer Name
    document.getElementById('customerName').addEventListener('change', (e) => {
        currentBill.customerName = e.target.value;
    });
    
    // Customer Phone
    document.getElementById('customerPhone').addEventListener('change', (e) => {
        currentBill.customerPhone = e.target.value;
    });
    
    // Customer Email
    document.getElementById('customerEmail').addEventListener('change', (e) => {
        currentBill.customerEmail = e.target.value;
    });
    
    // Payment Mode
    document.getElementById('paymentMode').addEventListener('change', (e) => {
        currentBill.paymentMode = e.target.value;
    });
    
    // Invoice Notes
    document.getElementById('invoiceNotes').addEventListener('change', (e) => {
        currentBill.notes = e.target.value;
    });
    
    // Discount Type
    document.querySelectorAll('input[name="discountType"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            discountType = e.target.value;
            calculateBillTotal();
        });
    });
    
    // Discount Value
    document.getElementById('discountValue').addEventListener('input', (e) => {
        discountValue = parseFloat(e.target.value) || 0;
        calculateBillTotal();
    });
    
    // Bill Hold
    document.getElementById('holdBillBtn').addEventListener('click', holdBill);
    
    // Tax Slider
    document.getElementById('taxSlider').addEventListener('input', (e) => {
        taxRate = parseFloat(e.target.value);
        document.getElementById('taxPercentageDisplay').textContent = taxRate;
        document.getElementById('taxPercentageLabel').textContent = taxRate;
        
        // Hide tax row if tax is 0
        const taxRow = document.getElementById('taxRow');
        if (taxRate === 0) {
            taxRow.style.display = 'none';
        } else {
            taxRow.style.display = 'flex';
        }
        
        calculateBillTotal();
    });
    
    // Inventory Search & Filters
    const searchInput = document.getElementById('productSearch');
    const categoryFilter = document.getElementById('categoryFilter');
    const stockFilter = document.getElementById('stockFilter');
    
    if (searchInput) searchInput.addEventListener('input', () => renderProducts());
    if (categoryFilter) categoryFilter.addEventListener('change', () => renderProducts());
    if (stockFilter) stockFilter.addEventListener('change', () => renderProducts());
}

// ============== PRODUCT MANAGEMENT ==============

function addProduct(e) {
    e.preventDefault();
    
    const name = document.getElementById('productName').value.trim();
    const sku = document.getElementById('productSKU').value.trim();
    const barcode = document.getElementById('productBarcode').value.trim();
    const category = document.getElementById('productCategory').value;
    const costPrice = parseFloat(document.getElementById('productCostPrice').value);
    const price = parseFloat(document.getElementById('productPrice').value);
    const mrp = parseFloat(document.getElementById('productMRP').value);
    const quantity = parseInt(document.getElementById('productQuantity').value);
    const reorderPoint = parseInt(document.getElementById('productReorderPoint').value) || 10;
    const description = document.getElementById('productDescription').value.trim();
    
    if (!name || costPrice <= 0 || price <= 0 || mrp <= 0 || quantity < 0) {
        showAlert('Please enter valid product details', 'error');
        return;
    }
    
    const product = {
        id: Date.now(),
        userId: currentUser ? currentUser.id : null,
        name: name,
        sku: sku || `SKU-${Date.now()}`,
        barcode: barcode || `BAR-${Date.now()}`,
        category: category,
        costPrice: costPrice,
        price: price,
        mrp: mrp,
        quantity: quantity,
        reorderPoint: reorderPoint,
        description: description,
        createdAt: new Date().toLocaleDateString('en-IN')
    };
    
    products.push(product);
    saveData();
    renderProducts();
    updateBillProductSelect();
    updateInventoryDashboard();
    
    // Reset Form
    document.getElementById('productForm').reset();
    toggleFormSection();
    showAlert('Product added successfully!', 'success');
}

function deleteProduct(productId) {
    if (confirm('Are you sure you want to delete this product?')) {
        products = products.filter(p => p.id !== productId);
        
        // Remove from bill if present
        billItems = billItems.filter(item => item.productId !== productId);
        
        saveData();
        renderProducts();
        renderBillItems();
        updateBillProductSelect();
        calculateBillTotal();
        updateInventoryDashboard();
        showAlert('Product deleted successfully!', 'success');
    }
}

function updateProductQuantity(productId, newQuantity) {
    const product = products.find(p => p.id === productId);
    if (product) {
        product.quantity = Math.max(0, parseInt(newQuantity));
        saveData();
        renderProducts();
        updateBillProductSelect();
        updateInventoryDashboard();
        showAlert('Inventory updated!', 'success');
    }
}

function editProduct(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    
    // Fill form with existing data
    document.getElementById('productName').value = product.name;
    document.getElementById('productSKU').value = product.sku;
    document.getElementById('productBarcode').value = product.barcode || '';
    document.getElementById('productCategory').value = product.category;
    document.getElementById('productCostPrice').value = product.costPrice || '';
    document.getElementById('productPrice').value = product.price;
    document.getElementById('productMRP').value = product.mrp || '';
    document.getElementById('productQuantity').value = product.quantity;
    document.getElementById('productReorderPoint').value = product.reorderPoint;
    document.getElementById('productDescription').value = product.description || '';
    
    // Show form
    const form = document.getElementById('productForm');
    form.style.display = 'block';
    
    // Update button to show "Update" and store productId
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Update Product';
    form._editingId = productId;
    
    // Change form submission behavior
    form.onsubmit = (e) => updateProductSubmit(e, productId);
    
    form.scrollIntoView({ behavior: 'smooth' });
    showAlert('Edit the product details and click Update', 'success');
}

function updateProductSubmit(e, productId) {
    e.preventDefault();
    
    const product = products.find(p => p.id === productId);
    if (!product) return;
    
    product.name = document.getElementById('productName').value.trim();
    product.sku = document.getElementById('productSKU').value.trim() || product.sku;
    product.barcode = document.getElementById('productBarcode').value.trim() || product.barcode;
    product.category = document.getElementById('productCategory').value;
    product.costPrice = parseFloat(document.getElementById('productCostPrice').value) || product.costPrice;
    product.price = parseFloat(document.getElementById('productPrice').value);
    product.mrp = parseFloat(document.getElementById('productMRP').value) || product.mrp;
    product.quantity = parseInt(document.getElementById('productQuantity').value);
    product.reorderPoint = parseInt(document.getElementById('productReorderPoint').value) || 10;
    product.description = document.getElementById('productDescription').value.trim();
    
    saveData();
    renderProducts();
    updateBillProductSelect();
    updateInventoryDashboard();
    
    // Reset form
    document.getElementById('productForm').reset();
    document.getElementById('productForm').style.display = 'none';
    document.getElementById('productForm').onsubmit = addProduct;
    document.querySelector('#productForm button[type="submit"]').textContent = 'Add Product';
    
    showAlert('Product updated successfully!', 'success');
}

function renderProducts() {
    const productsList = document.getElementById('productsList');
    
    if (products.length === 0) {
        productsList.innerHTML = '<p class="empty-state">No products added yet</p>';
        document.getElementById('productCount').textContent = '0';
        return;
    }
    
    // Apply search and filter
    let filteredProducts = applyFilters(products);
    document.getElementById('productCount').textContent = filteredProducts.length;
    
    if (filteredProducts.length === 0) {
        productsList.innerHTML = '<p class="empty-state">No products match the filters</p>';
        return;
    }
    
    productsList.innerHTML = filteredProducts.map(product => {
        const stockPercentage = (product.quantity / (product.reorderPoint * 2)) * 100;
        const isLowStock = product.quantity <= product.reorderPoint;
        const isOutOfStock = product.quantity === 0;
        const itemStatus = isOutOfStock ? 'out-of-stock' : isLowStock ? 'low-stock' : 'in-stock';
        const badgeIcon = isOutOfStock ? '⛔' : isLowStock ? '⚠️' : '✓';
        const badgeText = isOutOfStock ? 'Out of Stock' : isLowStock ? 'Low Stock' : 'In Stock';
        
        return `
            <div class="product-item ${itemStatus}">
                <span class="product-status-badge status-${itemStatus === 'out-of-stock' ? 'out-of-stock' : itemStatus === 'low-stock' ? 'low-stock' : 'in-stock'}">${badgeIcon} ${badgeText}</span>
                <div class="product-info">
                    <div class="product-header">
                        <div>
                            <div class="product-name">${product.name}</div>
                            <div class="product-sku">SKU: ${product.sku}</div>
                            <span class="product-category">${product.category}</span>
                        </div>
                    </div>
                    ${product.description ? `<div style="font-size: 0.85rem; color: #6b7280; margin: 6px 0;">${product.description}</div>` : ''}
                    <div class="product-details">
                        <div class="product-detail-item">
                            <strong>Barcode:</strong> ${product.barcode || 'N/A'}
                        </div>
                        <div class="product-detail-item">
                            <strong>Cost:</strong> ₹${product.costPrice ? product.costPrice.toFixed(2) : 'N/A'}
                        </div>
                        <div class="product-detail-item">
                            <strong>Selling Price:</strong> ₹${product.price.toFixed(2)}
                        </div>
                        <div class="product-detail-item">
                            <strong>MRP:</strong> ₹${product.mrp ? product.mrp.toFixed(2) : 'N/A'}
                        </div>
                        <div class="product-detail-item">
                            <strong>Stock:</strong> ${product.quantity} units
                        </div>
                        <div class="product-detail-item">
                            <strong>Reorder:</strong> ${product.reorderPoint} units
                        </div>
                        <div class="product-detail-item">
                            <strong>Stock Value:</strong> ₹${(product.quantity * product.price).toFixed(2)}
                        </div>
                        <div class="product-detail-item">
                            <strong>Margin:</strong> ${product.costPrice ? ((product.price - product.costPrice) / product.price * 100).toFixed(1) : 'N/A'}%
                        </div>
                    </div>
                </div>
                <div class="product-actions">
                    <div class="product-actions-row">
                        <input type="number" value="${product.quantity}" min="0"
                               onchange="updateProductQuantity(${product.id}, this.value)"
                               style="width: 70px; padding: 6px; border: 1px solid #e5e7eb; border-radius: 4px;">
                        <button class="btn btn-success" onclick="addToCartFromProduct(${product.id})" style="width: auto; padding: 6px 12px;" ${product.quantity === 0 ? 'disabled' : ''}>🛒 Add to Cart</button>
                        <button class="btn btn-warning" onclick="editProduct(${product.id})" style="width: 50px;">✏️</button>
                        <button class="btn btn-danger remove-btn" onclick="deleteProduct(${product.id})">🗑️</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function updateBillProductSelect() {
    const select = document.getElementById('billProductSelect');
    const currentValue = select.value;
    
    select.innerHTML = '<option value="">-- Select a product --</option>';
    
    products.forEach(product => {
        if (product.quantity > 0) {
            const option = document.createElement('option');
            option.value = product.id;
            option.textContent = `${product.name} (Stock: ${product.quantity}) - ₹${product.price.toFixed(2)}`;
            select.appendChild(option);
        }
    });
    
    select.value = currentValue;
}

// ============== BILLING MANAGEMENT ==============

function addToBill() {
    const productId = parseInt(document.getElementById('billProductSelect').value);
    const quantity = parseInt(document.getElementById('billQuantity').value);
    
    if (!productId) {
        showAlert('Please select a product', 'error');
        return;
    }
    
    if (quantity <= 0) {
        showAlert('Please enter a valid quantity', 'error');
        return;
    }
    
    const product = products.find(p => p.id === productId);
    
    if (!product) {
        showAlert('Product not found', 'error');
        return;
    }
    
    if (product.quantity < quantity) {
        showAlert(`Insufficient stock. Available: ${product.quantity}`, 'error');
        return;
    }
    
    // Check if product already in bill
    const existingItem = billItems.find(item => item.productId === productId);
    
    if (existingItem) {
        if (product.quantity >= existingItem.quantity + quantity) {
            existingItem.quantity += quantity;
        } else {
            showAlert(`Insufficient stock. Available: ${product.quantity - existingItem.quantity}`, 'error');
            return;
        }
    } else {
        billItems.push({
            productId: productId,
            name: product.name,
            price: product.price,
            quantity: quantity
        });
    }
    
    renderBillItems();
    calculateBillTotal();
    document.getElementById('billQuantity').value = 1;
    document.getElementById('billProductSelect').value = '';
    showAlert('Item added to bill!', 'success');
}

function addToCartFromProduct(productId) {
    const product = products.find(p => p.id === productId);
    
    if (!product) {
        showAlert('Product not found', 'error');
        return;
    }
    
    if (product.quantity === 0) {
        showAlert('Product is out of stock', 'error');
        return;
    }
    
    // Check if product already in bill
    const existingItem = billItems.find(item => item.productId === productId);
    
    if (existingItem) {
        if (product.quantity >= existingItem.quantity + 1) {
            existingItem.quantity += 1;
        } else {
            showAlert(`Insufficient stock. Available: ${product.quantity - existingItem.quantity}`, 'error');
            return;
        }
    } else {
        billItems.push({
            productId: productId,
            name: product.name,
            price: product.price,
            quantity: 1
        });
    }
    
    renderBillItems();
    calculateBillTotal();
    showAlert(`${product.name} added to cart!`, 'success');
}

function removeFromBill(productId) {
    billItems = billItems.filter(item => item.productId !== productId);
    renderBillItems();
    calculateBillTotal();
    showAlert('Item removed from bill!', 'success');
}

function updateBillItemQuantity(productId, newQuantity) {
    const item = billItems.find(item => item.productId === productId);
    if (item) {
        newQuantity = parseInt(newQuantity);
        
        if (newQuantity <= 0) {
            removeFromBill(productId);
            return;
        }
        
        const product = products.find(p => p.id === productId);
        if (product && product.quantity >= newQuantity) {
            item.quantity = newQuantity;
            renderBillItems();
            calculateBillTotal();
        } else {
            showAlert(`Insufficient stock. Available: ${product.quantity}`, 'error');
        }
    }
}

function renderBillItems() {
    const billItemsBody = document.getElementById('billItemsBody');
    
    if (billItems.length === 0) {
        billItemsBody.innerHTML = '<tr class="empty-row"><td colspan="5" class="empty-state">No items in bill</td></tr>';
        return;
    }
    
    billItemsBody.innerHTML = billItems.map(item => {
        const itemTotal = (item.price * item.quantity).toFixed(2);
        return `
            <tr>
                <td>${item.name}</td>
                <td>₹${item.price.toFixed(2)}</td>
                <td>
                    <div class="bill-quantity-control">
                        <button class="btn btn-secondary" onclick="updateBillItemQuantity(${item.productId}, ${item.quantity - 1})" style="width: 30px; padding: 0;">−</button>
                        <input type="number" value="${item.quantity}" 
                               onchange="updateBillItemQuantity(${item.productId}, this.value)" 
                               min="1">
                        <button class="btn btn-secondary" onclick="updateBillItemQuantity(${item.productId}, ${item.quantity + 1})" style="width: 30px; padding: 0;">+</button>
                    </div>
                </td>
                <td>₹${itemTotal}</td>
                <td>
                    <button class="btn btn-danger remove-btn" onclick="removeFromBill(${item.productId})">Remove</button>
                </td>
            </tr>
        `;
    }).join('');
}

function calculateBillTotal() {
    let subtotal = 0;
    
    billItems.forEach(item => {
        subtotal += item.price * item.quantity;
    });
    
    // Calculate discount
    let discount = 0;
    if (discountType === 'percentage') {
        discount = (subtotal * discountValue) / 100;
    } else {
        discount = discountValue;
    }
    discount = Math.min(discount, subtotal); // Don't allow discount more than subtotal
    
    const afterDiscount = subtotal - discount;
    const tax = (afterDiscount * taxRate) / 100; // Dynamic tax rate
    const total = afterDiscount + tax;
    
    currentBill.subtotal = subtotal;
    currentBill.discount = discount;
    currentBill.tax = tax;
    currentBill.total = total;
    currentBill.items = JSON.parse(JSON.stringify(billItems));
    
    document.getElementById('subtotal').textContent = '₹' + subtotal.toFixed(2);
    document.getElementById('discountAmount').textContent = '₹' + discount.toFixed(2);
    document.getElementById('afterDiscountAmount').textContent = '₹' + afterDiscount.toFixed(2);
    document.getElementById('taxAmount').textContent = '₹' + tax.toFixed(2);
    document.getElementById('totalAmount').textContent = '₹' + total.toFixed(2);
    
    // Show/hide discount rows
    const discountRow = document.getElementById('discountRow');
    const afterDiscountRow = document.getElementById('afterDiscountRow');
    if (discount > 0) {
        discountRow.style.display = 'flex';
        afterDiscountRow.style.display = 'flex';
    } else {
        discountRow.style.display = 'none';
        afterDiscountRow.style.display = 'none';
    }
}

function updateInvoiceNumber() {
    const invoiceNum = `INV-${String(invoiceCounter).padStart(3, '0')}`;
    currentBill.invoiceNumber = invoiceNum;
    document.getElementById('invoiceNumber').textContent = invoiceNum;
}

function updateInvoiceDate() {
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    currentBill.date = dateStr;
    document.getElementById('invoiceDate').textContent = dateStr;
}

function setPaymentMode(mode) {
    document.getElementById('paymentMode').value = mode;
    currentBill.paymentMode = mode;
    showAlert(`Payment mode set to ${mode}`, 'success');
}

function createNewBill() {
    if (billItems.length > 0) {
        if (!confirm('Are you sure you want to create a new bill? Current bill will be discarded.')) {
            return;
        }
    }
    
    invoiceCounter++;
    billItems = [];
    document.getElementById('customerName').value = '';
    document.getElementById('customerPhone').value = '';
    document.getElementById('customerEmail').value = '';
    document.getElementById('paymentMode').value = 'Cash';
    document.getElementById('billQuantity').value = 1;
    document.getElementById('billProductSelect').value = '';
    document.getElementById('discountValue').value = 0;
    document.getElementById('invoiceNotes').value = '';
    discountValue = 0;
    
    updateInvoiceNumber();
    updateInvoiceDate();
    renderBillItems();
    calculateBillTotal();
    
    showAlert('New bill created!', 'success');
}

// ============== PRINT & SAVE ==============

function printInvoice() {
    if (billItems.length === 0) {
        showAlert('Please add items to the bill before printing', 'error');
        return;
    }
    
    const printContainer = document.getElementById('printContainer');
    
    // Calculate total items and quantity
    const totalItems = currentBill.items.length;
    const totalQuantity = currentBill.items.reduce((sum, item) => sum + item.quantity, 0);
    
    let invoiceHTML = `
        <div class="invoice-print">
            <!-- Invoice Header -->
            <div class="invoice-header">
                <div class="invoice-title">TAX INVOICE</div>
                <div class="invoice-subtitle">Original Copy</div>
            </div>
            
            <!-- Shop and Invoice Details -->
            <div class="invoice-top-section">
                <div class="shop-details">
                    <div class="shop-name">${shopSettings.shopName || 'Your Store Name'}</div>
                    ${shopSettings.shopAddress ? `<div class="shop-address">${shopSettings.shopAddress}</div>` : ''}
                    <div class="shop-contact">
                        ${shopSettings.shopPhone ? `<span>📞 ${shopSettings.shopPhone}</span>` : ''}
                        ${shopSettings.shopEmail ? `<span>✉️ ${shopSettings.shopEmail}</span>` : ''}
                    </div>
                    ${shopSettings.shopGST ? `<div class="shop-gst">GSTIN: ${shopSettings.shopGST}</div>` : ''}
                    ${shopSettings.shopPAN ? `<div class="shop-pan">PAN: ${shopSettings.shopPAN}</div>` : ''}
                </div>
                <div class="invoice-details-box">
                    <div class="invoice-detail-row">
                        <span class="invoice-detail-label">Invoice No:</span>
                        <span class="invoice-detail-value">${currentBill.invoiceNumber}</span>
                    </div>
                    <div class="invoice-detail-row">
                        <span class="invoice-detail-label">Date:</span>
                        <span class="invoice-detail-value">${currentBill.date}</span>
                    </div>
                    <div class="invoice-detail-row">
                        <span class="invoice-detail-label">Payment:</span>
                        <span class="invoice-detail-value">${currentBill.paymentMode}</span>
                    </div>
                </div>
            </div>
            
            <!-- Customer Details -->
            <div class="customer-section">
                <div class="section-title">Bill To:</div>
                <div class="customer-details">
                    <div class="customer-name">${currentBill.customerName || 'Walk-in Customer'}</div>
                    ${currentBill.customerPhone ? `<div class="customer-info">📞 ${currentBill.customerPhone}</div>` : ''}
                    ${currentBill.customerEmail ? `<div class="customer-info">✉️ ${currentBill.customerEmail}</div>` : ''}
                </div>
            </div>
            
            <!-- Items Table -->
            <table class="invoice-table">
                <thead>
                    <tr>
                        <th style="width: 5%; text-align: center;">#</th>
                        <th style="width: 40%;">Item Description</th>
                        <th style="width: 15%; text-align: right;">Unit Price</th>
                        <th style="width: 10%; text-align: center;">Qty</th>
                        <th style="width: 15%; text-align: right;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${currentBill.items.map((item, index) => `
                        <tr>
                            <td style="text-align: center;">${index + 1}</td>
                            <td>${item.name}</td>
                            <td style="text-align: right;">₹${item.price.toFixed(2)}</td>
                            <td style="text-align: center;">${item.quantity}</td>
                            <td style="text-align: right;">₹${(item.price * item.quantity).toFixed(2)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            
            <!-- Summary Section -->
            <div class="invoice-summary-section">
                <div class="summary-left">
                    <div class="summary-box">
                        <div class="summary-title">Summary</div>
                        <div class="summary-row">
                            <span>Total Items:</span>
                            <span>${totalItems}</span>
                        </div>
                        <div class="summary-row">
                            <span>Total Quantity:</span>
                            <span>${totalQuantity}</span>
                        </div>
                    </div>
                    ${currentBill.notes ? `
                    <div class="notes-box">
                        <div class="notes-title">Notes:</div>
                        <div class="notes-content">${currentBill.notes}</div>
                    </div>
                    ` : ''}
                </div>
                <div class="summary-right">
                    <div class="totals-box">
                        <div class="total-row">
                            <span>Subtotal:</span>
                            <span>₹${currentBill.subtotal.toFixed(2)}</span>
                        </div>
                        ${currentBill.discount > 0 ? `
                        <div class="total-row discount">
                            <span>Discount ${discountType === 'percentage' ? `(${discountValue}%)` : ''}:</span>
                            <span>-₹${currentBill.discount.toFixed(2)}</span>
                        </div>
                        <div class="total-row">
                            <span>After Discount:</span>
                            <span>₹${(currentBill.subtotal - currentBill.discount).toFixed(2)}</span>
                        </div>
                        ` : ''}
                        <div class="total-row">
                            <span>Tax (${taxRate}%):</span>
                            <span>₹${currentBill.tax.toFixed(2)}</span>
                        </div>
                        <div class="total-row grand-total">
                            <span>Grand Total:</span>
                            <span>₹${currentBill.total.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Amount in Words -->
            <div class="amount-words">
                <span class="amount-words-label">Amount in Words:</span>
                <span class="amount-words-value">${numberToWords(Math.floor(currentBill.total))} Rupees Only</span>
            </div>
            
            <!-- Terms and Conditions -->
            <div class="terms-section">
                <div class="terms-title">Terms & Conditions:</div>
                <div class="terms-content">
                    <div>1. Goods once sold will not be taken back or exchanged.</div>
                    <div>2. All disputes are subject to local jurisdiction only.</div>
                    <div>3. Payment is due upon receipt of invoice.</div>
                </div>
            </div>
            
            <!-- Bank Details -->
            ${shopSettings.bankName ? `
            <div class="bank-details-section">
                <div class="bank-title">Bank Details:</div>
                <div class="bank-content">
                    <div><strong>Bank:</strong> ${shopSettings.bankName}</div>
                    ${shopSettings.accountNumber ? `<div><strong>A/C No:</strong> ${shopSettings.accountNumber}</div>` : ''}
                    ${shopSettings.ifscCode ? `<div><strong>IFSC:</strong> ${shopSettings.ifscCode}</div>` : ''}
                </div>
            </div>
            ` : ''}
            
            <!-- Signature Section -->
            <div class="signature-section">
                <div class="signature-box">
                    <div class="signature-line"></div>
                    <div class="signature-label">Customer Signature</div>
                </div>
                <div class="signature-box">
                    <div class="signature-line"></div>
                    <div class="signature-label">Authorized Signature</div>
                </div>
            </div>
            
            <!-- Footer -->
            <div class="invoice-footer">
                <div class="footer-message">${shopSettings.invoiceFooter || 'Thank you for your business!'}</div>
                <div class="footer-note">This is a computer generated invoice.</div>
            </div>
        </div>
    `;
    
    printContainer.innerHTML = invoiceHTML;
    
    window.print();
}

// Helper function to convert number to words
function numberToWords(num) {
    if (num === 0) return 'Zero';
    
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
                  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
                  'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    
    function convertLessThanHundred(n) {
        if (n < 20) return ones[n];
        return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    }
    
    function convertLessThanThousand(n) {
        if (n < 100) return convertLessThanHundred(n);
        return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convertLessThanHundred(n % 100) : '');
    }
    
    function convert(n) {
        if (n < 1000) return convertLessThanThousand(n);
        if (n < 100000) return convertLessThanThousand(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convertLessThanThousand(n % 1000) : '');
        if (n < 10000000) return convertLessThanThousand(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '');
        return convertLessThanThousand(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '');
    }
    
    return convert(num);
}

async function saveBill() {
    if (billItems.length === 0) {
        showAlert('Please add items to the bill before saving', 'error');
        return;
    }
    
    // Auto-save mode: skip confirmation
    if (!shopSettings.autoSaveTransactions) {
        if (!confirm('Are you sure you want to save this invoice?')) {
            return;
        }
    }
    
    try {
        // Deduct items from inventory
        billItems.forEach(billItem => {
            const product = products.find(p => p.id === billItem.productId);
            if (product) {
                product.quantity -= billItem.quantity;
            }
        });
        
        // Save bill to Firebase Realtime Database
        const billsRef = database.ref('bills');
        
        const billData = {
            userId: currentUser ? currentUser.id : null,
            invoiceNumber: currentBill.invoiceNumber,
            date: currentBill.date,
            customerName: currentBill.customerName,
            customerPhone: currentBill.customerPhone || '',
            customerEmail: currentBill.customerEmail || '',
            paymentMode: currentBill.paymentMode,
            items: currentBill.items,
            subtotal: currentBill.subtotal,
            discount: currentBill.discount,
            tax: currentBill.tax,
            total: currentBill.total,
            notes: currentBill.notes || '',
            billStatus: 'finalized',
            savedAt: new Date().toLocaleString('en-IN')
        };
        
        await billsRef.push(billData);
        
        // Save updated products
        saveData();
        renderProducts();
        
        showAlert(`Invoice ${currentBill.invoiceNumber} saved successfully!`, 'success');
        createNewBill();
    } catch (error) {
        console.error('Error saving bill:', error);
        showAlert('Error saving bill', 'error');
    }
}

// ============== INDEXEDDB OPERATIONS ==============

async function saveData() {
    try {
        // Save products to Firebase Realtime Database
        const productsRef = database.ref('products');
        await productsRef.set(products);
        console.log('Products saved to Firebase');
        
        // Save invoice counter to Firebase Realtime Database
        const metadataRef = database.ref('metadata');
        await metadataRef.set({ invoiceCounter: invoiceCounter });
        console.log('Invoice counter saved to Firebase');
    } catch (error) {
        console.error('Error saving data:', error);
        throw error;
    }
}

async function loadData() {
    try {
        // Load products from Firebase Realtime Database
        const productsRef = database.ref('products');
        const productsSnapshot = await productsRef.once('value');
        const allProducts = productsSnapshot.val() || [];
        
        // Filter products by current user (admin sees all, user sees only their own)
        if (currentUser && currentUser.role === 'admin') {
            products = Array.isArray(allProducts) ? allProducts : Object.values(allProducts);
        } else if (currentUser) {
            const productsArray = Array.isArray(allProducts) ? allProducts : Object.values(allProducts);
            products = productsArray.filter(p => p.userId === currentUser.id);
        } else {
            products = [];
        }
        console.log(`Loaded ${products.length} products from Firebase`);
        
        // Load invoice counter from Firebase Realtime Database
        const metadataRef = database.ref('metadata');
        const metadataSnapshot = await metadataRef.once('value');
        const metadata = metadataSnapshot.val();
        
        if (metadata && metadata.invoiceCounter) {
            invoiceCounter = metadata.invoiceCounter;
            console.log('Loaded invoice counter:', invoiceCounter);
        }
        
        updateBillProductSelect();
    } catch (error) {
        console.error('Error loading data:', error);
        throw error;
    }
}

// ============== UTILITY FUNCTIONS ==============

function showAlert(message, type) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type}`;
    alertDiv.textContent = message;
    
    // Insert at top of main content
    const mainContent = document.querySelector('.main-content');
    mainContent.insertBefore(alertDiv, mainContent.firstChild);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        alertDiv.remove();
    }, 3000);
}

// ============== SAVED BILLS MANAGEMENT ==============

async function getAllSavedBills() {
    try {
        const billsRef = database.ref('bills');
        const snapshot = await billsRef.once('value');
        const allBillsData = snapshot.val();
        
        if (!allBillsData) {
            return [];
        }
        
        // Convert object to array with IDs
        const allBills = Object.keys(allBillsData).map(key => ({
            ...allBillsData[key],
            id: key
        }));
        
        // Filter bills by current user (admin sees all, user sees only their own)
        if (currentUser && currentUser.role === 'admin') {
            return allBills;
        } else if (currentUser) {
            return allBills.filter(b => b.userId === currentUser.id);
        } else {
            return [];
        }
    } catch (error) {
        console.error('Error retrieving bills:', error);
        throw error;
    }
}

async function getBillByInvoiceNumber(invoiceNumber) {
    try {
        const billsRef = database.ref('bills');
        const snapshot = await billsRef.orderByChild('invoiceNumber').equalTo(invoiceNumber).once('value');
        const billsData = snapshot.val();
        
        if (!billsData) {
            return null;
        }
        
        // Get the first (and should be only) bill with this invoice number
        const billId = Object.keys(billsData)[0];
        return { ...billsData[billId], id: billId };
    } catch (error) {
        console.error('Error retrieving bill:', error);
        throw error;
    }
}

async function deleteSavedBill(billId) {
    try {
        const billRef = database.ref('bills/' + billId);
        await billRef.remove();
        console.log('Bill deleted successfully');
    } catch (error) {
        console.error('Error deleting bill:', error);
        throw error;
    }
}

async function printLastSavedBill() {
    try {
        const bills = await getAllSavedBills();
        
        if (bills.length === 0) {
            showAlert('No saved bills found', 'error');
            return;
        }
        
        // Get the last saved bill (most recent)
        const lastBill = bills[bills.length - 1];
        
        // Use the existing printSavedBill function
        await printSavedBill(lastBill.id);
        
    } catch (error) {
        console.error('Error printing last bill:', error);
        showAlert('Error printing last bill', 'error');
    }
}

// ============== MODAL MANAGEMENT ==============

async function openSavedBillsModal() {
    const modal = document.getElementById('savedBillsModal');
    const billsList = document.getElementById('savedBillsList');
    
    try {
        const bills = await getAllSavedBills();
        
        if (bills.length === 0) {
            billsList.innerHTML = '<p class="empty-state">No saved invoices yet</p>';
        } else {
            billsList.innerHTML = bills.map(bill => `
                <div class="saved-bill-item">
                    <div class="saved-bill-details">
                        <div class="saved-bill-header">
                            <div class="saved-bill-invoice">✓ ${bill.invoiceNumber}</div>
                            <div class="saved-bill-date">${bill.savedAt}</div>
                        </div>
                        <div class="saved-bill-info">
                            <div class="saved-bill-info-row">
                                <span class="saved-bill-info-label">Customer:</span> ${bill.customerName || 'N/A'}
                            </div>
                            <div class="saved-bill-info-row">
                                <span class="saved-bill-info-label">Items:</span> ${bill.items.length}
                            </div>
                            <div class="saved-bill-info-row">
                                <span class="saved-bill-info-label">Payment:</span> ${bill.paymentMode || 'Cash'}
                            </div>
                            <div class="saved-bill-info-row">
                                <span class="saved-bill-info-label">Total:</span> ₹${(bill.total || 0).toFixed(2)}
                            </div>
                        </div>
                    </div>
                    <div class="saved-bill-actions">
                        <button class="btn btn-info" onclick="printSavedBill(${bill.id})" style="width: 100px;">Print</button>
                        <button class="btn btn-danger remove-btn" onclick="confirmDeleteBill(${bill.id})">Delete</button>
                    </div>
                </div>
            `).join('');
        }
        
        loadHeldBillsDisplay();
        modal.classList.add('show');
    } catch (error) {
        console.error('Error loading bills:', error);
        billsList.innerHTML = '<p class="empty-state">Error loading bills</p>';
    }
}

function closeSavedBillsModal() {
    const modal = document.getElementById('savedBillsModal');
    modal.classList.remove('show');
}

async function printSavedBill(billId) {
    try {
        const billRef = database.ref('bills/' + billId);
        const snapshot = await billRef.once('value');
        const bill = snapshot.val();
        
        if (bill) {
                const printContainer = document.getElementById('printContainer');
                
                // Calculate total items and quantity
                const totalItems = bill.items.length;
                const totalQuantity = bill.items.reduce((sum, item) => sum + item.quantity, 0);
                
                let invoiceHTML = `
                    <div class="invoice-print">
                        <!-- Invoice Header -->
                        <div class="invoice-header">
                            <div class="invoice-title">TAX INVOICE</div>
                            <div class="invoice-subtitle">Original Copy</div>
                        </div>
                        
                        <!-- Shop and Invoice Details -->
                        <div class="invoice-top-section">
                            <div class="shop-details">
                                <div class="shop-name">${shopSettings.shopName || 'Your Store Name'}</div>
                                ${shopSettings.shopAddress ? `<div class="shop-address">${shopSettings.shopAddress}</div>` : ''}
                                <div class="shop-contact">
                                    ${shopSettings.shopPhone ? `<span>📞 ${shopSettings.shopPhone}</span>` : ''}
                                    ${shopSettings.shopEmail ? `<span>✉️ ${shopSettings.shopEmail}</span>` : ''}
                                </div>
                                ${shopSettings.shopGST ? `<div class="shop-gst">GSTIN: ${shopSettings.shopGST}</div>` : ''}
                                ${shopSettings.shopPAN ? `<div class="shop-pan">PAN: ${shopSettings.shopPAN}</div>` : ''}
                            </div>
                            <div class="invoice-details-box">
                                <div class="invoice-detail-row">
                                    <span class="invoice-detail-label">Invoice No:</span>
                                    <span class="invoice-detail-value">${bill.invoiceNumber}</span>
                                </div>
                                <div class="invoice-detail-row">
                                    <span class="invoice-detail-label">Date:</span>
                                    <span class="invoice-detail-value">${bill.date}</span>
                                </div>
                                <div class="invoice-detail-row">
                                    <span class="invoice-detail-label">Payment:</span>
                                    <span class="invoice-detail-value">${bill.paymentMode || 'Cash'}</span>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Customer Details -->
                        <div class="customer-section">
                            <div class="section-title">Bill To:</div>
                            <div class="customer-details">
                                <div class="customer-name">${bill.customerName || 'Walk-in Customer'}</div>
                                ${bill.customerPhone ? `<div class="customer-info">📞 ${bill.customerPhone}</div>` : ''}
                                ${bill.customerEmail ? `<div class="customer-info">✉️ ${bill.customerEmail}</div>` : ''}
                            </div>
                        </div>
                        
                        <!-- Items Table -->
                        <table class="invoice-table">
                            <thead>
                                <tr>
                                    <th style="width: 5%; text-align: center;">#</th>
                                    <th style="width: 40%;">Item Description</th>
                                    <th style="width: 15%; text-align: right;">Unit Price</th>
                                    <th style="width: 10%; text-align: center;">Qty</th>
                                    <th style="width: 15%; text-align: right;">Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${bill.items.map((item, index) => `
                                    <tr>
                                        <td style="text-align: center;">${index + 1}</td>
                                        <td>${item.name}</td>
                                        <td style="text-align: right;">₹${item.price.toFixed(2)}</td>
                                        <td style="text-align: center;">${item.quantity}</td>
                                        <td style="text-align: right;">₹${(item.price * item.quantity).toFixed(2)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                        
                        <!-- Summary Section -->
                        <div class="invoice-summary-section">
                            <div class="summary-left">
                                <div class="summary-box">
                                    <div class="summary-title">Summary</div>
                                    <div class="summary-row">
                                        <span>Total Items:</span>
                                        <span>${totalItems}</span>
                                    </div>
                                    <div class="summary-row">
                                        <span>Total Quantity:</span>
                                        <span>${totalQuantity}</span>
                                    </div>
                                </div>
                                ${bill.notes ? `
                                <div class="notes-box">
                                    <div class="notes-title">Notes:</div>
                                    <div class="notes-content">${bill.notes}</div>
                                </div>
                                ` : ''}
                            </div>
                            <div class="summary-right">
                                <div class="totals-box">
                                    <div class="total-row">
                                        <span>Subtotal:</span>
                                        <span>₹${(bill.subtotal || 0).toFixed(2)}</span>
                                    </div>
                                    ${bill.discount > 0 ? `
                                    <div class="total-row discount">
                                        <span>Discount ${bill.discountType === 'percentage' ? `(${bill.discountValue}%)` : ''}:</span>
                                        <span>-₹${(bill.discount || 0).toFixed(2)}</span>
                                    </div>
                                    <div class="total-row">
                                        <span>After Discount:</span>
                                        <span>₹${((bill.subtotal || 0) - (bill.discount || 0)).toFixed(2)}</span>
                                    </div>
                                    ` : ''}
                                    <div class="total-row">
                                        <span>Tax:</span>
                                        <span>₹${(bill.tax || 0).toFixed(2)}</span>
                                    </div>
                                    <div class="total-row grand-total">
                                        <span>Grand Total:</span>
                                        <span>₹${(bill.total || 0).toFixed(2)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Amount in Words -->
                        <div class="amount-words">
                            <span class="amount-words-label">Amount in Words:</span>
                            <span class="amount-words-value">${numberToWords(Math.floor(bill.total || 0))} Rupees Only</span>
                        </div>
                        
                        <!-- Terms and Conditions -->
                        <div class="terms-section">
                            <div class="terms-title">Terms & Conditions:</div>
                            <div class="terms-content">
                                <div>1. Goods once sold will not be taken back or exchanged.</div>
                                <div>2. All disputes are subject to local jurisdiction only.</div>
                                <div>3. Payment is due upon receipt of invoice.</div>
                            </div>
                        </div>
                        
                        <!-- Bank Details -->
                        ${shopSettings.bankName ? `
                        <div class="bank-details-section">
                            <div class="bank-title">Bank Details:</div>
                            <div class="bank-content">
                                <div><strong>Bank:</strong> ${shopSettings.bankName}</div>
                                ${shopSettings.accountNumber ? `<div><strong>A/C No:</strong> ${shopSettings.accountNumber}</div>` : ''}
                                ${shopSettings.ifscCode ? `<div><strong>IFSC:</strong> ${shopSettings.ifscCode}</div>` : ''}
                            </div>
                        </div>
                        ` : ''}
                        
                        <!-- Signature Section -->
                        <div class="signature-section">
                            <div class="signature-box">
                                <div class="signature-line"></div>
                                <div class="signature-label">Customer Signature</div>
                            </div>
                            <div class="signature-box">
                                <div class="signature-line"></div>
                                <div class="signature-label">Authorized Signature</div>
                            </div>
                        </div>
                        
                        <!-- Footer -->
                        <div class="invoice-footer">
                            <div class="footer-message">${shopSettings.invoiceFooter || 'Thank you for your business!'}</div>
                            <div class="footer-note">This is a computer generated invoice.</div>
                        </div>
                    </div>
                `;
                
                printContainer.innerHTML = invoiceHTML;
                window.print();
            }
        }
    catch (error) {
        console.error('Error printing bill:', error);
        showAlert('Error printing bill', 'error');
    }
}

async function confirmDeleteBill(billId) {
    if (confirm('Are you sure you want to delete this invoice?')) {
        try {
            await deleteSavedBill(billId);
            showAlert('Invoice deleted successfully!', 'success');
            openSavedBillsModal();
        } catch (error) {
            console.error('Error deleting bill:', error);
            showAlert('Error deleting invoice', 'error');
        }
    }
}

function exportData() {
    getAllSavedBills().then(bills => {
        const exportData = {
            products: products,
            bills: bills,
            invoiceCounter: invoiceCounter,
            exportDate: new Date().toLocaleString('en-IN')
        };
        
        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `billing_inventory_backup_${Date.now()}.json`;
        link.click();
        URL.revokeObjectURL(url);
        
        showAlert('Data exported successfully!', 'success');
    }).catch(error => {
        console.error('Error exporting data:', error);
        showAlert('Error exporting data', 'error');
    });
}

async function clearDatabase() {
    if (confirm('⚠️ WARNING: This will delete all data! Are you sure?') &&
        confirm('This action cannot be undone. Type "DELETE ALL" to confirm: ')) {

        const userInput = prompt('Type "DELETE ALL" to confirm deletion of all data:');
        if (userInput === 'DELETE ALL') {
            try {
                // Clear products from Firebase
                const productsRef = database.ref('products');
                await productsRef.remove();

                // Clear bills from Firebase
                const billsRef = database.ref('bills');
                await billsRef.remove();

                // Clear metadata from Firebase
                const metadataRef = database.ref('metadata');
                await metadataRef.remove();

                // Reset app state
                products = [];
                billItems = [];
                invoiceCounter = 1;
                currentBill = {
                    invoiceNumber: 'INV-001',
                    date: new Date().toLocaleDateString(),
                    customerName: '',
                    customerPhone: '',
                    customerEmail: '',
                    items: [],
                    subtotal: 0,
                    tax: 0,
                    total: 0,
                    notes: ''
                };

                renderProducts();
                renderBillItems();
                updateInvoiceNumber();
                updateBillProductSelect();
                closeSavedBillsModal();

                showAlert('All data has been cleared!', 'success');
            } catch (error) {
                console.error('Error clearing database:', error);
                showAlert('Error clearing database', 'error');
            }
        } else {
            showAlert('Database clear cancelled', 'error');
        }
    }
}

// ============== BILL HOLD FUNCTIONALITY ==============

function holdBill() {
    if (billItems.length === 0) {
        showAlert('Please add items to the bill before holding', 'error');
        return;
    }
    
    const heldBillData = {
        id: Date.now(),
        invoiceNumber: currentBill.invoiceNumber,
        date: currentBill.date,
        customerName: currentBill.customerName || 'Walk-in Customer',
        customerPhone: currentBill.customerPhone || '',
        customerEmail: currentBill.customerEmail || '',
        paymentMode: currentBill.paymentMode,
        items: JSON.parse(JSON.stringify(billItems)),
        subtotal: currentBill.subtotal,
        discount: currentBill.discount,
        discountType: discountType,
        discountValue: discountValue,
        tax: currentBill.tax,
        total: currentBill.total,
        notes: currentBill.notes || '',
        heldAt: new Date().toLocaleString('en-IN')
    };
    
    heldBills.push(heldBillData);
    localStorage.setItem('heldBills', JSON.stringify(heldBills));
    
    showAlert(`Bill held successfully! (${heldBillData.customerName})`, 'success');
    createNewBill();
}

function loadHeldBills() {
    const saved = localStorage.getItem('heldBills');
    if (saved) {
        heldBills = JSON.parse(saved);
    }
}

function resumeHeldBill(heldBillId) {
    const heldBill = heldBills.find(b => b.id === heldBillId);
    if (!heldBill) {
        showAlert('Held bill not found', 'error');
        return;
    }
    
    // Load the held bill data
    billItems = JSON.parse(JSON.stringify(heldBill.items));
    document.getElementById('customerName').value = heldBill.customerName;
    document.getElementById('customerPhone').value = heldBill.customerPhone || '';
    document.getElementById('customerEmail').value = heldBill.customerEmail || '';
    document.getElementById('paymentMode').value = heldBill.paymentMode;
    document.getElementById('discountValue').value = heldBill.discountValue;
    document.getElementById('invoiceNotes').value = heldBill.notes || '';
    discountValue = heldBill.discountValue;
    discountType = heldBill.discountType;
    document.querySelector(`input[name="discountType"][value="${discountType}"]`).checked = true;
    
    currentBill.invoiceNumber = heldBill.invoiceNumber;
    
    renderBillItems();
    calculateBillTotal();
    closeSavedBillsModal();
    
    showAlert(`Bill resumed: ${heldBill.customerName}`, 'success');
    document.querySelector('.billing-panel').scrollIntoView({ behavior: 'smooth' });
}

function deleteHeldBill(heldBillId) {
    if (confirm('Are you sure you want to delete this held bill?')) {
        heldBills = heldBills.filter(b => b.id !== heldBillId);
        localStorage.setItem('heldBills', JSON.stringify(heldBills));
        showAlert('Held bill deleted!', 'success');
        openSavedBillsModal();
    }
}

// ============== MODAL TAB SWITCHING ==============

function switchModalTab(tab) {
    const savedDiv = document.getElementById('savedBillsList');
    const heldDiv = document.getElementById('heldBillsList');
    const tabs = document.querySelectorAll('.modal-tab-btn');
    
    tabs.forEach(t => t.classList.remove('active'));
    
    if (tab === 'saved') {
        savedDiv.style.display = 'block';
        heldDiv.style.display = 'none';
        tabs[0].classList.add('active');
    } else if (tab === 'held') {
        savedDiv.style.display = 'none';
        heldDiv.style.display = 'block';
        tabs[1].classList.add('active');
        loadHeldBillsDisplay();
    }
}

function loadHeldBillsDisplay() {
    const heldBillsList = document.getElementById('heldBillsList');
    
    if (heldBills.length === 0) {
        heldBillsList.innerHTML = '<p class="empty-state">No held bills</p>';
        return;
    }
    
    heldBillsList.innerHTML = heldBills.map(bill => `
        <div class="saved-bill-item">
            <div class="saved-bill-details">
                <div class="saved-bill-header">
                    <div class="saved-bill-invoice">📋 ${bill.invoiceNumber}</div>
                    <div class="saved-bill-date">${bill.heldAt}</div>
                </div>
                <div class="saved-bill-info">
                    <div class="saved-bill-info-row">
                        <span class="saved-bill-info-label">Customer:</span> ${bill.customerName}
                    </div>
                    <div class="saved-bill-info-row">
                        <span class="saved-bill-info-label">Items:</span> ${bill.items.length}
                    </div>
                    <div class="saved-bill-info-row">
                        <span class="saved-bill-info-label">Payment:</span> ${bill.paymentMode}
                    </div>
                    <div class="saved-bill-info-row">
                        <span class="saved-bill-info-label">Total:</span> ₹${(bill.total || 0).toFixed(2)}
                    </div>
                </div>
            </div>
            <div class="saved-bill-actions">
                <button class="btn btn-success" onclick="resumeHeldBill(${bill.id})" style="width: 100px;">Resume</button>
                <button class="btn btn-danger remove-btn" onclick="deleteHeldBill(${bill.id})">Delete</button>
            </div>
        </div>
    `).join('');
}

// ============== INVENTORY ENHANCEMENTS ==============

function toggleFormSection() {
    const form = document.getElementById('productForm');
    const btn = document.querySelector('.form-toggle');
    
    if (form.style.display === 'none') {
        form.style.display = 'block';
        btn.textContent = '⊖ Close Form';
    } else {
        form.style.display = 'none';
        btn.textContent = '⊕ Add New Product';
    }
}

function applyFilters(productList) {
    const searchTerm = document.getElementById('productSearch').value.toLowerCase();
    const categoryFilter = document.getElementById('categoryFilter').value;
    const stockFilter = document.getElementById('stockFilter').value;
    
    return productList.filter(product => {
        // Search filter (name or SKU)
        const matchesSearch = product.name.toLowerCase().includes(searchTerm) || 
                             product.sku.toLowerCase().includes(searchTerm);
        
        // Category filter
        const matchesCategory = !categoryFilter || product.category === categoryFilter;
        
        // Stock filter
        let matchesStock = true;
        if (stockFilter === 'in-stock') {
            matchesStock = product.quantity > product.reorderPoint;
        } else if (stockFilter === 'low-stock') {
            matchesStock = product.quantity > 0 && product.quantity <= product.reorderPoint;
        } else if (stockFilter === 'out-of-stock') {
            matchesStock = product.quantity === 0;
        }
        
        return matchesSearch && matchesCategory && matchesStock;
    });
}

function updateInventoryDashboard() {
    // Total products
    document.getElementById('totalProducts').textContent = products.length;
    
    // Total stock value
    const totalValue = products.reduce((sum, p) => sum + (p.quantity * p.price), 0);
    document.getElementById('totalStockValue').textContent = '₹' + totalValue.toFixed(2);
    
    // Low stock count
    const lowStockCount = products.filter(p => p.quantity <= p.reorderPoint && p.quantity > 0).length;
    const outOfStockCount = products.filter(p => p.quantity === 0).length;
    document.getElementById('lowStockCount').textContent = `${lowStockCount + outOfStockCount}`;
}

function exportProducts() {
    if (products.length === 0) {
        showAlert('No products to export', 'error');
        return;
    }
    
    const exportData = products.map(p => ({
        'Product Name': p.name,
        'SKU': p.sku,
        'Barcode': p.barcode,
        'Category': p.category,
        'Cost Price': p.costPrice,
        'Selling Price': p.price,
        'MRP': p.mrp,
        'Margin': ((p.price - p.costPrice) / p.price * 100).toFixed(2) + '%',
        'Quantity': p.quantity,
        'Reorder Point': p.reorderPoint,
        'Stock Value': (p.quantity * p.price).toFixed(2),
        'Description': p.description
    }));
    
    // Convert to CSV
    const headers = Object.keys(exportData[0]);
    const csvContent = [
        headers.join(','),
        ...exportData.map(row => 
            headers.map(h => {
                const val = row[h];
                return typeof val === 'string' && val.includes(',') ? `"${val}"` : val;
            }).join(',')
        )
    ].join('\n');
    
    // Download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `inventory_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    
    showAlert('Inventory exported successfully!', 'success');
}

// ============== REPORTS FUNCTIONALITY ==============

function switchReportTab(tab) {
    // Hide all report tab contents
    document.querySelectorAll('.report-tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    // Remove active class from all nav buttons
    document.querySelectorAll('.report-nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected tab content
    document.getElementById(tab + 'Report').classList.add('active');
    
    // Add active class to clicked button
    event.target.classList.add('active');
    
    // Generate report for the selected tab
    generateReport();
}

function generateReport() {
    const startDate = document.getElementById('reportStartDate').value;
    const endDate = document.getElementById('reportEndDate').value;
    const category = document.getElementById('reportCategory').value;
    
    // Get all saved bills
    getAllSavedBills().then(bills => {
        // Filter bills by date range if provided
        let filteredBills = bills;
        
        if (startDate || endDate) {
            filteredBills = bills.filter(bill => {
                const billDate = parseBillDate(bill.date);
                if (startDate && endDate) {
                    const start = new Date(startDate);
                    const end = new Date(endDate);
                    return billDate >= start && billDate <= end;
                } else if (startDate) {
                    const start = new Date(startDate);
                    return billDate >= start;
                } else if (endDate) {
                    const end = new Date(endDate);
                    return billDate <= end;
                }
                return true;
            });
        }
        
        // Generate reports based on active tab
        const activeTab = document.querySelector('.report-tab-content.active');
        if (activeTab) {
            const tabId = activeTab.id;
            
            if (tabId === 'salesReport') {
                generateSalesReport(filteredBills);
            } else if (tabId === 'inventoryReport') {
                generateInventoryReport(category);
            } else if (tabId === 'customerReport') {
                generateCustomerReport(filteredBills);
            } else if (tabId === 'profitReport') {
                generateProfitReport(filteredBills, category);
            }
        }
    }).catch(error => {
        console.error('Error generating report:', error);
        showAlert('Error generating report', 'error');
    });
}

function parseBillDate(dateStr) {
    // Parse date string in format DD/MM/YYYY
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        return new Date(parts[2], parts[1] - 1, parts[0]);
    }
    return new Date(dateStr);
}

function generateSalesReport(bills) {
    // Calculate totals
    const totalRevenue = bills.reduce((sum, bill) => sum + (bill.total || 0), 0);
    const totalInvoices = bills.length;
    const totalItemsSold = bills.reduce((sum, bill) => {
        return sum + bill.items.reduce((itemSum, item) => itemSum + item.quantity, 0);
    }, 0);
    const avgInvoiceValue = totalInvoices > 0 ? totalRevenue / totalInvoices : 0;
    
    // Update summary cards
    document.getElementById('totalRevenue').textContent = '₹' + totalRevenue.toFixed(2);
    document.getElementById('totalInvoices').textContent = totalInvoices;
    document.getElementById('totalItemsSold').textContent = totalItemsSold;
    document.getElementById('avgInvoiceValue').textContent = '₹' + avgInvoiceValue.toFixed(2);
    
    // Generate sales trend chart (last 7 days)
    generateSalesTrendChart(bills);
    
    // Generate payment mode chart
    generatePaymentModeChart(bills);
    
    // Generate recent transactions table
    generateRecentTransactionsTable(bills);
}

function generateSalesTrendChart(bills) {
    const chartContainer = document.getElementById('salesTrendChart');
    const last7Days = [];
    const dailyTotals = {};
    
    // Get last 7 days
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        last7Days.push(dateStr);
        dailyTotals[dateStr] = 0;
    }
    
    // Calculate daily totals
    bills.forEach(bill => {
        const billDate = parseBillDate(bill.date);
        const dateStr = billDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        if (dailyTotals.hasOwnProperty(dateStr)) {
            dailyTotals[dateStr] += bill.total || 0;
        }
    });
    
    // Find max value for scaling
    const maxValue = Math.max(...Object.values(dailyTotals), 1);
    
    // Generate chart HTML
    let chartHTML = '';
    last7Days.forEach(day => {
        const value = dailyTotals[day];
        const percentage = (value / maxValue) * 100;
        chartHTML += `
            <div class="chart-bar-item">
                <div class="chart-bar-label">${day}</div>
                <div class="chart-bar-container">
                    <div class="chart-bar" style="width: ${percentage}%">₹${value.toFixed(0)}</div>
                </div>
            </div>
        `;
    });
    
    chartContainer.innerHTML = chartHTML;
}

function generatePaymentModeChart(bills) {
    const chartContainer = document.getElementById('paymentModeChart');
    const paymentModes = {};
    
    // Count payment modes
    bills.forEach(bill => {
        const mode = bill.paymentMode || 'Cash';
        paymentModes[mode] = (paymentModes[mode] || 0) + 1;
    });
    
    // Calculate total for percentages
    const total = Object.values(paymentModes).reduce((sum, count) => sum + count, 0);
    
    // Colors for different payment modes
    const colors = {
        'Cash': '#10b981',
        'Card': '#3b82f6',
        'UPI': '#8b5cf6',
        'Check': '#f59e0b',
        'Online Transfer': '#06b6d4',
        'Wallet': '#ec4899',
        'Credit': '#ef4444'
    };
    
    // Generate chart HTML
    let chartHTML = '';
    Object.entries(paymentModes).forEach(([mode, count]) => {
        const percentage = total > 0 ? (count / total * 100).toFixed(1) : 0;
        const color = colors[mode] || '#6b7280';
        chartHTML += `
            <div class="chart-pie-item">
                <div class="chart-pie-color" style="background: ${color}"></div>
                <div class="chart-pie-label">${mode}</div>
                <div class="chart-pie-value">${count} (${percentage}%)</div>
            </div>
        `;
    });
    
    chartContainer.innerHTML = chartHTML || '<p class="empty-state">No data available</p>';
}

function generateRecentTransactionsTable(bills) {
    const tableBody = document.getElementById('salesReportTableBody');
    
    if (bills.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="empty-state">No transactions found</td></tr>';
        return;
    }
    
    // Sort bills by date (most recent first)
    const sortedBills = [...bills].sort((a, b) => {
        const dateA = parseBillDate(a.date);
        const dateB = parseBillDate(b.date);
        return dateB - dateA;
    });
    
    // Show last 10 transactions
    const recentBills = sortedBills.slice(0, 10);
    
    tableBody.innerHTML = recentBills.map(bill => `
        <tr>
            <td>${bill.invoiceNumber}</td>
            <td>${bill.date}</td>
            <td>${bill.customerName || 'Walk-in Customer'}</td>
            <td>${bill.items.length}</td>
            <td>${bill.paymentMode || 'Cash'}</td>
            <td>₹${(bill.total || 0).toFixed(2)}</td>
        </tr>
    `).join('');
}

function generateInventoryReport(category) {
    // Filter products by category if provided
    let filteredProducts = products;
    if (category) {
        filteredProducts = products.filter(p => p.category === category);
    }
    
    // Calculate totals
    const totalProducts = filteredProducts.length;
    const stockValue = filteredProducts.reduce((sum, p) => sum + (p.quantity * p.price), 0);
    const lowStock = filteredProducts.filter(p => p.quantity > 0 && p.quantity <= p.reorderPoint).length;
    const outOfStock = filteredProducts.filter(p => p.quantity === 0).length;
    
    // Update summary cards
    document.getElementById('reportTotalProducts').textContent = totalProducts;
    document.getElementById('reportStockValue').textContent = '₹' + stockValue.toFixed(2);
    document.getElementById('reportLowStock').textContent = lowStock;
    document.getElementById('reportOutOfStock').textContent = outOfStock;
    
    // Generate category stock chart
    generateCategoryStockChart(filteredProducts);
    
    // Generate stock status chart
    generateStockStatusChart(filteredProducts);
    
    // Generate inventory table
    generateInventoryTable(filteredProducts);
}

function generateCategoryStockChart(products) {
    const chartContainer = document.getElementById('categoryStockChart');
    const categoryStock = {};
    
    // Calculate stock by category
    products.forEach(product => {
        const category = product.category || 'Other';
        categoryStock[category] = (categoryStock[category] || 0) + product.quantity;
    });
    
    // Find max value for scaling
    const maxValue = Math.max(...Object.values(categoryStock), 1);
    
    // Generate chart HTML
    let chartHTML = '';
    Object.entries(categoryStock).forEach(([category, stock]) => {
        const percentage = (stock / maxValue) * 100;
        chartHTML += `
            <div class="chart-bar-item">
                <div class="chart-bar-label">${category}</div>
                <div class="chart-bar-container">
                    <div class="chart-bar" style="width: ${percentage}%">${stock} units</div>
                </div>
            </div>
        `;
    });
    
    chartContainer.innerHTML = chartHTML || '<p class="empty-state">No data available</p>';
}

function generateStockStatusChart(products) {
    const chartContainer = document.getElementById('stockStatusChart');
    
    const inStock = products.filter(p => p.quantity > p.reorderPoint).length;
    const lowStock = products.filter(p => p.quantity > 0 && p.quantity <= p.reorderPoint).length;
    const outOfStock = products.filter(p => p.quantity === 0).length;
    
    const total = products.length;
    
    const statusData = [
        { label: 'In Stock', count: inStock, color: '#10b981' },
        { label: 'Low Stock', count: lowStock, color: '#f59e0b' },
        { label: 'Out of Stock', count: outOfStock, color: '#ef4444' }
    ];
    
    let chartHTML = '';
    statusData.forEach(status => {
        const percentage = total > 0 ? (status.count / total * 100).toFixed(1) : 0;
        chartHTML += `
            <div class="chart-pie-item">
                <div class="chart-pie-color" style="background: ${status.color}"></div>
                <div class="chart-pie-label">${status.label}</div>
                <div class="chart-pie-value">${status.count} (${percentage}%)</div>
            </div>
        `;
    });
    
    chartContainer.innerHTML = chartHTML;
}

function generateInventoryTable(products) {
    const tableBody = document.getElementById('inventoryReportTableBody');
    
    if (products.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" class="empty-state">No products found</td></tr>';
        return;
    }
    
    tableBody.innerHTML = products.map(product => {
        const stockValue = product.quantity * product.price;
        const isLowStock = product.quantity > 0 && product.quantity <= product.reorderPoint;
        const isOutOfStock = product.quantity === 0;
        const status = isOutOfStock ? 'Out of Stock' : isLowStock ? 'Low Stock' : 'In Stock';
        const statusClass = isOutOfStock ? 'out-of-stock' : isLowStock ? 'low-stock' : 'in-stock';
        
        return `
            <tr>
                <td>${product.name}</td>
                <td>${product.sku}</td>
                <td>${product.category}</td>
                <td>${product.quantity}</td>
                <td>${product.reorderPoint}</td>
                <td>₹${stockValue.toFixed(2)}</td>
                <td><span class="status-badge ${statusClass}">${status}</span></td>
            </tr>
        `;
    }).join('');
}

function generateCustomerReport(bills) {
    // Group bills by customer
    const customerData = {};
    
    bills.forEach(bill => {
        const customerName = bill.customerName || 'Walk-in Customer';
        const customerPhone = bill.customerPhone || '';
        const customerEmail = bill.customerEmail || '';
        
        if (!customerData[customerName]) {
            customerData[customerName] = {
                name: customerName,
                phone: customerPhone,
                email: customerEmail,
                totalPurchases: 0,
                totalSpent: 0,
                lastPurchase: bill.date
            };
        }
        
        customerData[customerName].totalPurchases++;
        customerData[customerName].totalSpent += bill.total || 0;
        
        // Update last purchase date if newer
        const currentDate = parseBillDate(bill.date);
        const lastDate = parseBillDate(customerData[customerName].lastPurchase);
        if (currentDate > lastDate) {
            customerData[customerName].lastPurchase = bill.date;
        }
    });
    
    const customers = Object.values(customerData);
    
    // Calculate summary
    const totalCustomers = customers.length;
    const repeatCustomers = customers.filter(c => c.totalPurchases > 1).length;
    const totalSpent = customers.reduce((sum, c) => sum + c.totalSpent, 0);
    const avgCustomerValue = totalCustomers > 0 ? totalSpent / totalCustomers : 0;
    
    // Find top customer
    const topCustomer = customers.reduce((top, customer) => {
        return customer.totalSpent > (top?.totalSpent || 0) ? customer : top;
    }, null);
    
    // Update summary cards
    document.getElementById('totalCustomers').textContent = totalCustomers;
    document.getElementById('repeatCustomers').textContent = repeatCustomers;
    document.getElementById('avgCustomerValue').textContent = '₹' + avgCustomerValue.toFixed(2);
    document.getElementById('topCustomer').textContent = topCustomer?.name || '-';
    
    // Generate customer table
    generateCustomerTable(customers);
}

function generateCustomerTable(customers) {
    const tableBody = document.getElementById('customerReportTableBody');
    
    if (customers.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="empty-state">No customers found</td></tr>';
        return;
    }
    
    // Sort by total spent (highest first)
    const sortedCustomers = [...customers].sort((a, b) => b.totalSpent - a.totalSpent);
    
    tableBody.innerHTML = sortedCustomers.map(customer => `
        <tr>
            <td>${customer.name}</td>
            <td>${customer.phone || '-'}</td>
            <td>${customer.email || '-'}</td>
            <td>${customer.totalPurchases}</td>
            <td>₹${customer.totalSpent.toFixed(2)}</td>
            <td>${customer.lastPurchase}</td>
        </tr>
    `).join('');
}

function generateProfitReport(bills, category) {
    // Calculate profit data
    const profitData = {};
    
    bills.forEach(bill => {
        bill.items.forEach(item => {
            const product = products.find(p => p.id === item.productId);
            if (product) {
                // Filter by category if provided
                if (category && product.category !== category) {
                    return;
                }
                
                if (!profitData[product.name]) {
                    profitData[product.name] = {
                        name: product.name,
                        unitsSold: 0,
                        revenue: 0,
                        cost: 0,
                        profit: 0
                    };
                }
                
                profitData[product.name].unitsSold += item.quantity;
                profitData[product.name].revenue += item.price * item.quantity;
                profitData[product.name].cost += (product.costPrice || 0) * item.quantity;
            }
        });
    });
    
    // Calculate profit for each product
    Object.values(profitData).forEach(data => {
        data.profit = data.revenue - data.cost;
    });
    
    const profitArray = Object.values(profitData);
    
    // Calculate totals
    const totalRevenue = profitArray.reduce((sum, p) => sum + p.revenue, 0);
    const totalCost = profitArray.reduce((sum, p) => sum + p.cost, 0);
    const grossProfit = totalRevenue - totalCost;
    const profitMargin = totalRevenue > 0 ? (grossProfit / totalRevenue * 100) : 0;
    
    // Update summary cards
    document.getElementById('profitTotalRevenue').textContent = '₹' + totalRevenue.toFixed(2);
    document.getElementById('profitTotalCost').textContent = '₹' + totalCost.toFixed(2);
    document.getElementById('grossProfit').textContent = '₹' + grossProfit.toFixed(2);
    document.getElementById('grossProfit').className = 'report-card-value ' + (grossProfit >= 0 ? 'profit-positive' : 'profit-negative');
    document.getElementById('profitMargin').textContent = profitMargin.toFixed(1) + '%';
    document.getElementById('profitMargin').className = 'report-card-value ' + (profitMargin >= 0 ? 'profit-positive' : 'profit-negative');
    
    // Generate profit by category chart
    generateProfitByCategoryChart(bills, category);
    
    // Generate top products chart
    generateTopProductsChart(profitArray);
    
    // Generate profit table
    generateProfitTable(profitArray);
}

function generateProfitByCategoryChart(bills, category) {
    const chartContainer = document.getElementById('profitByCategoryChart');
    const categoryProfit = {};
    
    bills.forEach(bill => {
        bill.items.forEach(item => {
            const product = products.find(p => p.id === item.productId);
            if (product) {
                const cat = product.category || 'Other';
                if (!categoryProfit[cat]) {
                    categoryProfit[cat] = 0;
                }
                const revenue = item.price * item.quantity;
                const cost = (product.costPrice || 0) * item.quantity;
                categoryProfit[cat] += revenue - cost;
            }
        });
    });
    
    // Find max value for scaling
    const maxValue = Math.max(...Object.values(categoryProfit).map(Math.abs), 1);
    
    // Generate chart HTML
    let chartHTML = '';
    Object.entries(categoryProfit).forEach(([cat, profit]) => {
        const percentage = Math.abs(profit) / maxValue * 100;
        const color = profit >= 0 ? '#10b981' : '#ef4444';
        chartHTML += `
            <div class="chart-bar-item">
                <div class="chart-bar-label">${cat}</div>
                <div class="chart-bar-container">
                    <div class="chart-bar" style="width: ${percentage}%; background: ${color}">₹${profit.toFixed(0)}</div>
                </div>
            </div>
        `;
    });
    
    chartContainer.innerHTML = chartHTML || '<p class="empty-state">No data available</p>';
}

function generateTopProductsChart(profitArray) {
    const chartContainer = document.getElementById('topProductsChart');
    
    // Sort by units sold and take top 5
    const topProducts = [...profitArray]
        .sort((a, b) => b.unitsSold - a.unitsSold)
        .slice(0, 5);
    
    if (topProducts.length === 0) {
        chartContainer.innerHTML = '<p class="empty-state">No data available</p>';
        return;
    }
    
    const maxValue = Math.max(...topProducts.map(p => p.unitsSold), 1);
    
    let chartHTML = '';
    topProducts.forEach(product => {
        const percentage = (product.unitsSold / maxValue) * 100;
        chartHTML += `
            <div class="chart-bar-item">
                <div class="chart-bar-label">${product.name.substring(0, 15)}${product.name.length > 15 ? '...' : ''}</div>
                <div class="chart-bar-container">
                    <div class="chart-bar" style="width: ${percentage}%">${product.unitsSold} units</div>
                </div>
            </div>
        `;
    });
    
    chartContainer.innerHTML = chartHTML;
}

function generateProfitTable(profitArray) {
    const tableBody = document.getElementById('profitReportTableBody');
    
    if (profitArray.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="empty-state">No data available</td></tr>';
        return;
    }
    
    // Sort by profit (highest first)
    const sortedData = [...profitArray].sort((a, b) => b.profit - a.profit);
    
    tableBody.innerHTML = sortedData.map(data => {
        const margin = data.revenue > 0 ? (data.profit / data.revenue * 100) : 0;
        const profitClass = data.profit >= 0 ? 'profit-positive' : 'profit-negative';
        
        return `
            <tr>
                <td>${data.name}</td>
                <td>${data.unitsSold}</td>
                <td>₹${data.revenue.toFixed(2)}</td>
                <td>₹${data.cost.toFixed(2)}</td>
                <td class="${profitClass}">₹${data.profit.toFixed(2)}</td>
                <td class="${profitClass}">${margin.toFixed(1)}%</td>
            </tr>
        `;
    }).join('');
}

function exportReport() {
    const activeTab = document.querySelector('.report-tab-content.active');
    if (!activeTab) {
        showAlert('Please generate a report first', 'error');
        return;
    }
    
    const tabId = activeTab.id;
    let reportData = {};
    let filename = '';
    
    if (tabId === 'salesReport') {
        reportData = {
            type: 'Sales Report',
            generatedAt: new Date().toLocaleString('en-IN'),
            summary: {
                totalRevenue: document.getElementById('totalRevenue').textContent,
                totalInvoices: document.getElementById('totalInvoices').textContent,
                totalItemsSold: document.getElementById('totalItemsSold').textContent,
                avgInvoiceValue: document.getElementById('avgInvoiceValue').textContent
            }
        };
        filename = 'sales_report';
    } else if (tabId === 'inventoryReport') {
        reportData = {
            type: 'Inventory Report',
            generatedAt: new Date().toLocaleString('en-IN'),
            summary: {
                totalProducts: document.getElementById('reportTotalProducts').textContent,
                stockValue: document.getElementById('reportStockValue').textContent,
                lowStock: document.getElementById('reportLowStock').textContent,
                outOfStock: document.getElementById('reportOutOfStock').textContent
            },
            products: products
        };
        filename = 'inventory_report';
    } else if (tabId === 'customerReport') {
        reportData = {
            type: 'Customer Report',
            generatedAt: new Date().toLocaleString('en-IN'),
            summary: {
                totalCustomers: document.getElementById('totalCustomers').textContent,
                repeatCustomers: document.getElementById('repeatCustomers').textContent,
                avgCustomerValue: document.getElementById('avgCustomerValue').textContent,
                topCustomer: document.getElementById('topCustomer').textContent
            }
        };
        filename = 'customer_report';
    } else if (tabId === 'profitReport') {
        reportData = {
            type: 'Profit Analysis Report',
            generatedAt: new Date().toLocaleString('en-IN'),
            summary: {
                totalRevenue: document.getElementById('profitTotalRevenue').textContent,
                totalCost: document.getElementById('profitTotalCost').textContent,
                grossProfit: document.getElementById('grossProfit').textContent,
                profitMargin: document.getElementById('profitMargin').textContent
            }
        };
        filename = 'profit_report';
    }
    
    // Convert to JSON and download
    const dataStr = JSON.stringify(reportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    
    showAlert('Report exported successfully!', 'success');
}

// Initialize reports on page load
document.addEventListener('DOMContentLoaded', () => {
    // Set default date range (last 30 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    
    document.getElementById('reportStartDate').value = startDate.toISOString().split('T')[0];
    document.getElementById('reportEndDate').value = endDate.toISOString().split('T')[0];
    
    // Generate initial report
    setTimeout(() => {
        generateReport();
    }, 500);
});

