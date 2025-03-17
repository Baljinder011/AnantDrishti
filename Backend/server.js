const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const multer = require("multer");
const path = require("path");
const bcrypt = require("bcrypt");
require('dotenv').config();
const crypto = require("crypto");
const axios = require("axios");
const nodemailer = require("nodemailer");
const fs = require("fs");
const dotenv = require("dotenv")
dotenv.config();

const https = require("https");



const app = express();

// :white_tick: Define allowed origins
const allowedOrigins = ['https://api.indraq.tech', 'https://indraq.tech', 'http://localhost:3000', 'http://localhost:3001'];
// :white_tick: Proper CORS Middleware
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS not allowed for this origin"));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));
// :white_tick: Manually Set Headers for Debugging
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const frontendPath = path.join(__dirname, "..", "Frontend"); // Adjust if needed
app.use(express.static(path.join(__dirname, frontendPath)));
app.use(express.static(frontendPath));
app.use(bodyParser.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const PORT = process.env.PORT || 4000


const options = {
  key: fs.readFileSync("/etc/letsencrypt/live/indraq.tech/privkey.pem"),
  cert: fs.readFileSync("/etc/letsencrypt/live/indraq.tech/fullchain.pem"),
};



// Enforce HTTPS middleware


app.use((req, res, next) => {
  if (req.protocol !== "https") {
    return res.redirect("https://" + req.headers.host + req.url);
  }
  next();
});






// MongoDB connection

const uri = "mongodb://localhost:27017/AnantDrishti";
mongoose.connect(uri)
  .then(() => console.log("Connected to MongoDB"))
  .catch((error) => {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  });



// Cashfree API Credentials
const APP_ID = process.env.CASHFREE_APP_ID || "YOUR_APP_ID";
const SECRET_KEY = process.env.CASHFREE_SECRET_KEY || "YOUR_SECRET_KEY";



// Function to generate expiry time (30 minutes from now)
function getExpiryTime() {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 30);
  return now.toISOString();
}

// Generate Order ID (ORD001, ORD002...)
async function generateOrderId() {
  const lastOrder = await Order.findOne().sort({ createdAt: -1 });
  if (lastOrder && lastOrder.orderId) {
    const lastNumber = parseInt(lastOrder.orderId.replace("ORD", ""), 10);
    return `ORD${String(lastNumber + 1).padStart(3, '0')}`;
  }
  return "ORD001";
}


// Create Payment Link & Save Order with linkId
app.post("/create-payment-link", async (req, res) => {
  try {
    const { customer_name, customer_email, customer_phone, amount } = req.body;
    if (!customer_name || !customer_email || !customer_phone || !amount) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const orderId = await generateOrderId();
    const linkId = `CF_${crypto.randomBytes(8).toString("hex")}`; // Generate Unique linkId

    const payload = {
      order_id: orderId, // Store orderId in Cashfree
      link_id: linkId, // Pass generated linkId
      customer_details: { customer_name, customer_email, customer_phone },
      link_amount: amount,
      link_currency: "INR",
      link_purpose: "E-commerce Purchase",
      link_notify: { send_email: true, send_sms: true },
      link_auto_reminders: true,
      link_expiry_time: new Date(Date.now() + 3600 * 1000).toISOString(), // 1-hour expiry
      link_meta: {
        return_url: `http://localhost:${PORT}/redirect.html?orderId=${orderId}&linkId=${linkId}`,
        // return_url: `https://indraq.tech/redirect.html?orderId=${orderId}&linkId=${linkId}`,

      },
    };

    const response = await axios.post("https://sandbox.cashfree.com/pg/links", payload, {
      headers: {
        "x-api-version": "2022-09-01",
        "x-client-id": APP_ID,
        "x-client-secret": SECRET_KEY,
      },
    });

    // Save Order in MongoDB including linkId
    const newOrder = new Order({
      orderId,
      linkId, // Store Cashfree linkId
      customerName: customer_name,
      customerEmail: customer_email,
      customerPhone: customer_phone,
      amount,
      status: "pending",
    });

    await newOrder.save();
    res.json({ success: true, orderId, linkId, linkUrl: response.data.link_url });
  } catch (error) {
    console.error("Cashfree Error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to create payment link" });
  }
});



// Check Payment Status & Update Order
app.get("/check-payment-status", async (req, res) => {
  try {
    const { orderId, linkId } = req.query;
    if (!orderId || !linkId) {
      return res.status(400).json({ error: "Missing orderId or linkId" });
    }

    const order = await Order.findOne({ orderId, linkId });
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    console.log(`Checking payment status for Order: ${orderId}, Link ID: ${linkId}`);

    // Use linkId to fetch payment status
    const cashfreeResponse = await axios.get(
      `https://sandbox.cashfree.com/pg/links/${linkId}`,
      {
        headers: {
          "x-api-version": "2022-09-01",
          "x-client-id": APP_ID,
          "x-client-secret": SECRET_KEY,
        },
      }
    );

    console.log("Cashfree API Response:", cashfreeResponse.data);

    const linkStatus = cashfreeResponse.data.link_status;
    let orderStatus = "pending";
    let paymentStatus = "pending";
    let paid = false;

    if (linkStatus === "PAID") {
      orderStatus = "successful";
      paymentStatus = "PAID";
      paid = true;
    } else if (linkStatus === "EXPIRED" || linkStatus === "CANCELLED") {
      orderStatus = "failed";
      paymentStatus = linkStatus.toLowerCase();
    }

    await Order.updateOne(
      { orderId, linkId },
      {
        $set: {
          status: orderStatus,
          "paymentDetails.status": paymentStatus,
          "paymentDetails.paid": paid,
          "paymentDetails.transactionId": cashfreeResponse.data.reference_id || "",
          "paymentDetails.timestamp": new Date(),
        },
      }
    );

    res.json({ success: orderStatus === "successful", status: orderStatus });
  } catch (error) {
    console.error("Error checking payment status:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to check payment status" });
  }
});


// Fetch Order by Order ID
app.get("/order", async (req, res) => {
  try {
    const { orderId } = req.query;
    if (!orderId) {
      return res.status(400).json({ error: "Missing orderId" });
    }

    const order = await Order.findOne({ orderId });
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json({ success: true, order });
  } catch (error) {
    console.error("Error fetching order:", error);
    res.status(500).json({ error: "Failed to fetch order" });
  }
});





// Serve Static Pages
app.get("/redirect.html", (req, res) => res.sendFile(path.join(frontendPath, "redirect.html")));
app.get("/success.html", (req, res) => res.sendFile(path.join(frontendPath, "success.html")));
app.get("/failure.html", (req, res) => res.sendFile(path.join(frontendPath, "failure.html")));











// const upload = multer({
//   storage: storage,
//   limits: { fileSize: 5 * 1024 * 1024 }, // Limit file size to 5 MB
//   fileFilter: (req, file, cb) => {
//     const fileTypes = /jpeg|jpg|png|gif/;
//     const extname = fileTypes.test(path.extname(file.originalname).toLowerCase());
//     const mimeType = fileTypes.test(file.mimetype);

//     if (extname && mimeType) {
//       return cb(null, true);
//     } else {
//       return cb(new Error("Only image files are allowed (jpeg, jpg, png, gif)"), false);
//     }
//   },
// });





// Define the User Schema






// Profile Schema and Model













// Define User Schema
// const userSchema = new mongoose.Schema({
//   userId: { type: String, required: true, unique: true }, // Unique user ID
//   firstName: { type: String, required: true },
//   lastName: { type: String, required: true },
//   email: { type: String, required: true, unique: true, lowercase: true },
//   password: { type: String, required: true, minlength: 6 },
//   phone: { type: String, required: true, match: /^[0-9]{10}$/ },
//   createdAt: { type: Date, default: Date.now },
// });

// const User = mongoose.model("User", userSchema);






// User Schema & Model
const userSchema = new mongoose.Schema({
  userId: { type: String, unique: true },
  profileImage: { type: String, default: "" },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  gender:{type:String,required:true},
  password: { type: String, required: true }, // Add this field
  dob: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },

  address: [{
    fullName: String,
    phone: String,
    pincode: String,
    address: String,
    city: String,
    state: String,
    country:String,
    isDefaultAddress: Boolean
  }],
  loginSessions: [
    {
      date: String,
      time: String,
      location: String
    }
  ],
  orders: [
    {
      orderId: String,
      productName: String,
      price: Number,
      date: String,
      status: String
    }
  ]
}, { timestamps: true });

const User = mongoose.model("users", userSchema);


// 📌 API to Save or Update Address
app.post("/save-address", async (req, res) => {
  const { userId, newAddress, addressIndex } = req.body;

  try {
    const user = await User.findOne({ userId });

    if (!user) return res.status(404).json({ message: "User not found" });

    if (addressIndex !== undefined && user.address[addressIndex]) {
      // 🔹 Update only changed fields of the existing address
      Object.assign(user.address[addressIndex], newAddress);
    } else {
      // 🔹 If no addressIndex, add a new address
      user.address.push(newAddress);
    }

    await user.save();
    res.json({ message: "Address saved successfully", address: user.address });

  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});





// 📌 API to Fetch Addresses
app.get("/get-address", async (req, res) => {
  const { userId } = req.query;

  try {
      const user = await User.findOne({ userId });

      if (!user) return res.status(404).json({ message: "User not found" });

      res.json(user.address);
  } catch (err) {
      console.error("Error:", err);
      res.status(500).json({ message: "Server error", error: err.message });
  }
});



app.delete("/delete-address", async (req, res) => {
  try {
      const { userId, index } = req.body;

      if (!userId || index === undefined) {
          return res.status(400).json({ message: "Missing required fields." });
      }

      // Find the user
      const user = await User.findOne({ userId });

      if (!user) {
          return res.status(404).json({ message: "User not found." });
      }

      if (!user.address || index < 0 || index >= user.address.length) {
          return res.status(400).json({ message: "Invalid address index." });
      }

      // Remove the address at the given index
      user.address.splice(index, 1);

      // Save updated user data
      await user.save();

      return res.json({ message: "Address deleted successfully." });
  } catch (error) {
      console.error("Delete Address Error:", error);
      res.status(500).json({ message: "Internal server error." });
  }
});





app.get("/get-user", async (req, res) => {
  try {
      const { email } = req.query;
      if (!email) return res.json({ success: false, message: "Email is required" });

      const user = await customers.findOne({ email });
      if (!user) return res.json({ success: false, message: "User not found" });

      res.json({ success: true, user });
  } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
  }
});







app.post("/update-profile", async (req, res) => {
  const { email, firstName, lastName, phone, dob, gender } = req.body;

  try {
    // Find user by email
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update user details
    user.firstName = firstName;
    user.lastName = lastName;
    user.phone = phone;
    user.dob = dob;
    user.gender = gender
    // user.address = address; // Replace existing address array

    // Save updated user
    await user.save();

    res.status(200).json({ message: "Profile updated successfully", user });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ message: "Server error" });
  }
});









// Ensure `uploads/Userprofile/` folder exists
const uploadDir = path.join(__dirname, "uploads/Userprofile");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// File upload setup
const userStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir); // Save images in the "uploads/Userprofile" folder
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname); // Unique filename
  }
});

const uploadProfile = multer({ storage: userStorage });




// API Route to Update Profile Image
app.post("/upload-profile-image", uploadProfile.single("profileImage"), async (req, res) => {
  try {
    const { email } = req.body; // Get email from request
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    // Find user and update profile image
    const updatedUser = await User.findOneAndUpdate(
      { email },
      { profileImage: `/uploads/Userprofile/${req.file.filename}` }, // Corrected image path
      { new: true }
    );

    if (!updatedUser) return res.status(404).json({ message: "User not found" });

    res.status(200).json({ message: "Profile image updated", user: updatedUser });
  } catch (error) {
    console.error("Error uploading image:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});





async function generateUserId(firstName) {
  const baseId = firstName.toLowerCase(); // Use first name as prefix

  const lastUser = await User.findOne().sort({ userId: -1 }); // Find last created user

  if (!lastUser) {
    return `${baseId}001`; // First user starts with their name + 001
  }

  const lastNumber = parseInt(lastUser.userId.match(/\d+$/)?.[0] || "0"); // Extract last numeric part
  const newNumber = (lastNumber + 1).toString().padStart(3, "0"); // Increment and format

  return `${baseId}${newNumber}`;
}





// Signup Route
app.post("/signup", async (req, res) => {
  console.log("Received request body:", req.body);

  const { firstName, lastName, email, password, phone } = req.body;

  if (!firstName || !lastName || !email || !password || !phone) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Generate global incremental userId using firstName
    const userId = await generateUserId(firstName);

    // Create and save user
    const newUser = new User({ userId, firstName, lastName, email, password, phone });
    await newUser.save();

    console.log("User saved successfully:", newUser);
    res.status(201).json({ message: "User registered successfully", userId });
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});





// My Login api

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    // Find user in the User collection
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    // Check password (plain text comparison)
    if (user.password !== password) {
      return res.status(400).json({ message: "Invalid password" });
    }

    // Find user profile (if exists)
    let userProfile = {
      fullName: user.fullName,
      phone: user.phone,
      image: null, // Default to null
    };

    try {
      const profile = await User.findOne({ email });
      if (profile && profile.image) {
        userProfile.image = profile.image;
      }
    } catch (profileError) {
      console.warn("Profile fetch error:", profileError.message); // Non-blocking warning
    }

    res.status(200).json({ message: "Login successful", userProfile });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});




// Fetch Profile Data Route
app.get("/getProfile", async (req, res) => {
  const email = req.query.email;  // Get the email from the query parameters

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    // Find profile data by email
    const profile = await User.findOne({ email: email });

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    res.status(200).json({ profile });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});





// Save or Update Profile Route
app.post("/saveProfile", uploadProfile.single("image"), async (req, res) => {
  try {
    const profileInfo = req.body;

    if (!profileInfo.name || !profileInfo.email) {
      return res.status(400).json({ message: "Name and email are required" });
    }

    const profileData = {
      name: profileInfo.name,
      email: profileInfo.email,
      phone: profileInfo.phone,
      image: req.file ? req.file.path : "uploads/default-profile.png", // Default image fallback
    };

    const existingProfile = await User.findOne({ email: profileInfo.email });

    if (existingProfile) {
      // Update existing profile
      await User.updateOne({ email: profileInfo.email }, profileData);
      return res.status(200).json({ message: "Profile updated successfully!" });
    }

    // Create a new profile
    const newProfile = new Profile(profileData);
    await newProfile.save();
    res.status(200).json({ message: "Profile saved successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error saving profile", error: err.message });
  }
});



// const addressSchema = new mongoose.Schema({
//   userId: { type: String, required: true }, // Identify the user
//   name: { type: String, required: true },
//   email: { type: String, required: true },
//   phone: Number,
//   address: { type: String, required: true },
//   city: { type: String, required: true },
//   state: { type: String, required: true },
//   pin: { type: String, required: true },
//   country: { type: String, required: true },
//   isDefaultAddress: { type: Boolean, default: false }
// });

// const Address = mongoose.model("Address", addressSchema);














app.get("/products/search", async (req, res) => {
  try {
    const query = req.query.query;
    if (!query) {
      return res.status(400).json({ message: "Search query is required" });
    }

    const products = await Product.find({ name: { $regex: query, $options: "i" } });

    if (products.length === 0) {
      return res.status(404).json({ message: "No products found" });
    }

    res.json(products);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});











// app.post('/products', upload.single('image'), async (req, res) => {
//   try {
//     const productData = {
//       ...req.body,
//       price: parseFloat(req.body.price),
//       stock: parseInt(req.body.stock),
//       discount: parseFloat(req.body.discount),
//       image: req.file ? `/uploads/${req.file.filename}` : '',
//     };
//     const product = new Product(productData);
//     await product.save();
//     res.status(201).json(product);
//   } catch (error) {
//     res.status(500).json({ message: 'Error creating product', error });
//   }
// });


// Product Schema & Model
const productSchema = new mongoose.Schema({
  name: String,
  description: String,
  image: String,
  price: Number,
  stock: Number,
  status: { type: String, enum: ['available', 'out of stock'], default: 'available' },
  category: String,
  discount: Number,
  size: String,
  color: String,
});
const Product = mongoose.model('products', productSchema);




// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/Products/');
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage: storage });



app.post('/products', upload.single('image'), async (req, res) => {
  try {
      // :white_tick: Add CORS Headers to Response
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    console.log(":inbox_tray: Incoming Request Body:", req.body);
    console.log(":outbox_tray: Uploaded File:", req.file);
    if (!req.body.name || !req.body.price || !req.body.category) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Image upload failed" });
    }
    const imagePath = `/uploads/Products/${req.file.filename}`;
    const newProduct = new Product({
      name: req.body.name,
      description: req.body.description,
      price: parseFloat(req.body.price),  // :white_tick: Ensure numeric fields are numbers
      stock: parseInt(req.body.stock),
      status: req.body.status,
      category: req.body.category,
      discount: parseFloat(req.body.discount),
      size: req.body.size,
      color: req.body.color,
      image: imagePath
    });
    console.log(":memo: Saving product to database:", newProduct);
    await newProduct.save();
    console.log(":white_tick: Product saved successfully:", newProduct);
    res.status(201).json(newProduct);
  } catch (error) {
    console.error(":x: MongoDB Save Error:", error);
    res.status(500).json({ error: "Error saving product", details: error.message });
  }
});




app.get("/products", async (req, res) => {
  try {
    const products = await Product.find({});
    res.json(products);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).send("Error fetching products");
  }
});


app.get("/products/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: ":x: Invalid product ID format" });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ message: ":x: Product not found" });
    }

    res.status(200).json(product);
  } catch (error) {
    console.error(":x: Error fetching product:", error);
    res.status(500).json({ message: ":x: Error fetching product", error });
  }
});

app.delete('/products/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting product', error });
  }
});

// Update Product
app.put('/products/:id', upload.single('image'), async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    let imagePath = product.image; // Keep existing image if not updated
    if (req.file) {
      imagePath = `/uploads/Products/${req.file.originalname}`; // :white_check_mark: Store new image in correct folder
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      { ...req.body, image: imagePath },
      { new: true }
    );

    res.json(updatedProduct);
  } catch (error) {
    console.error(":x: Error updating product:", error);
    res.status(500).json({ error: "Error updating product" });
  }
});



app.put('/products/:id/status', async (req, res) => {
  try {
    console.log("Received request to update product status for ID:", req.params.id);

    const product = await Product.findById(req.params.id);
    if (!product) {
      console.log("Product not found");
      return res.status(404).json({ message: 'Product not found' });
    }

    // Toggle status
    product.status = product.status === 'available' ? 'out of stock' : 'available';

    // Save changes
    await product.save();
    console.log("Product status updated:", product.status);

    res.json({ success: true, message: 'Product status updated', product });
  } catch (error) {
    console.error("Error updating product status:", error);
    res.status(500).json({ message: 'Error updating product status', error });
  }
});




// const profileSchema = new mongoose.Schema({
//   name: String,
//   email: { type: String, required: true, unique: true },
//   phone: String,
//   dob: String,
//   image: String, // Store image file path
// });
// profileSchema.index({ email: 1 });
// const Profile = mongoose.model("Profile", profileSchema);

















// Order Schema
const orderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true }, // Custom Order ID
  linkId: String,
  customerName: String,
  customerEmail: String,
  customerPhone: String,
  orderDetails: Array,
  Price: Number,
  paymentDetails: {
    method: String,
    transactionId: String,
    status: { type: String, default: 'pending' }, // Payment status
    paid: { type: Boolean, default: false }, // New field indicating if payment is made
    timestamp: Date
  },
  status: { type: String, default: 'pending' },  // New field for order status
  createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model("Order", orderSchema);







// Save Order Before Payment
app.post("/save-order", async (req, res) => {
  try {
    const { orderId, customerName, customerEmail, customerPhone, orderDetails, paymentDetails } = req.body;

    if (!orderId || !customerName || !customerEmail || !customerPhone || !orderDetails || orderDetails.length === 0) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const existingOrder = await Order.findOne({ orderId });
    if (existingOrder) {
      return res.json({ success: true, message: "Order already exists", orderId });
    }

    const newOrder = new Order({
      orderId,
      linkId,  // ✅ Make sure this is saved!
      customerName: customer_name,
      customerEmail: customer_email,
      customerPhone: customer_phone,
      Price,
      status: 'pending'
    });
    await newOrder.save();

    res.json({ success: true, orderId });
  } catch (error) {
    console.error("Error saving order:", error);
    res.status(500).json({ error: "Failed to save order" });
  }
});



// Fetch orders and payment details
app.get("/get-orders", async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 }); // Get orders sorted by latest first
    res.json({ success: true, orders });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ success: false, message: "Failed to fetch orders" });
  }
});




app.delete("/delete-order/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const deletedOrder = await Order.findOneAndDelete({ orderId });

    if (!deletedOrder) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    res.json({ success: true, message: "Order deleted successfully" });
  } catch (error) {
    console.error("Error deleting order:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});



// Start Server

// app.listen(PORT, () => {
//   console.log(`Server running on http://localhost:${PORT}`);
// });


// Start HTTPS server

https.createServer(options, app).listen(PORT, () => {
  console.log(`Secure server running on HTTPS at port ${PORT}`);
});
