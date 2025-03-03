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
const router = express.Router();
// const https = require("https");
// const fs = require("fs");


const app = express();

// Middleware
app.use(cors());
app.use(express.json());


const frontendPath = path.join(__dirname, "..", "Frontend"); // Adjust if needed
console.log("Serving frontend from:", frontendPath); // Debugging
app.use(express.static(frontendPath));
app.use(bodyParser.json());
app.use("/Photos", express.static(path.join(__dirname, "Photos")));



const PORT = process.env.PORT


// const options = {
//   key: fs.readFileSync("/etc/letsencrypt/live/indraq.tech/privkey.pem"),
//   cert: fs.readFileSync("/etc/letsencrypt/live/indraq.tech/fullchain.pem"),
// };



// Enforce HTTPS middleware


// app.use((req, res, next) => {
//   if (req.protocol !== "https") {
//     return res.redirect("https://" + req.headers.host + req.url);
//   }
//   next();
// });






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

// Create Payment Link API
app.post("/create-payment-link", async (req, res) => {
  try {
    const { customer_name, customer_email, customer_phone, amount } = req.body;

    if (!customer_name || !customer_email || !customer_phone || !amount) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const link_id = `CF_${crypto.randomBytes(8).toString("hex")}`;
    const apiUrl = "https://sandbox.cashfree.com/pg/links";

    const payload = {
      link_id,
      customer_details: { customer_name, customer_email, customer_phone },
      link_amount: amount,
      link_currency: "INR",
      link_purpose: "E-commerce Purchase",
      link_notify: { send_email: true, send_sms: true },
      link_auto_reminders: true,
      link_expiry_time: getExpiryTime(),
      link_meta: {
        // return_url: `http://localhost:${PORT}/redirect.html?link_id=${link_id}`
           return_url: `http://localhost:${PORT}/redirect.html?link_id=${link_id}`

      }
    };

    const response = await axios.post(apiUrl, payload, {
      headers: {
        "Content-Type": "application/json",
        "x-api-version": "2022-09-01",
        "x-client-id": APP_ID,
        "x-client-secret": SECRET_KEY
      }
    });

    res.json({ link_id: response.data.link_id, link_url: response.data.link_url });
  } catch (error) {
    console.error("Cashfree API Error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to create payment link", details: error.response?.data || error.message });
  }
});






// **Check Payment Status**
app.get("/check-payment-status", async (req, res) => {
  const linkId = req.query.link_id;
  if (!linkId) {
    return res.status(400).json({ error: "Missing Payment Link ID" });
  }

  try {
    const response = await axios.get(`https://sandbox.cashfree.com/pg/links/${linkId}`, {
      headers: {
        "x-api-version": "2022-09-01",
        "x-client-id": APP_ID,
        "x-client-secret": SECRET_KEY
      }
    });

    res.json({ link_status: response.data.link_status });
  } catch (error) {
    res.status(500).json({
      error: "Error checking payment status",
      details: error.response?.data || error.message || "Unknown error occurred"
    });
  }
});



// **Serve Static HTML Pages from "frontend" folder**
// const frontendPath = path.join(__dirname, "../frontend");

// Serve `payment.html`
app.get("/redirect.html", (req, res) => {
  res.sendFile(path.join(frontendPath, "redirect.html"), (err) => {
    if (err) {
      console.error("Error serving payment.html:", err);
      res.status(404).send("Payment page not found");
    }
  });
});

// Serve `success.html`
app.get("/success.html", (req, res) => {
  res.sendFile(path.join(frontendPath, "success.html"), (err) => {
    if (err) {
      console.error("Error serving success.html:", err);
      res.status(404).send("Success page not found");
    }
  });
});

// Serve `failure.html`
app.get("/failure.html", (req, res) => {
  res.sendFile(path.join(frontendPath, "failure.html"), (err) => {
    if (err) {
      console.error("Error serving failure.html:", err);
      res.status(404).send("Failure page not found");
    }
  });
});



// File upload setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "Photos/"); // Save to uploads folder
  }, filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Unique file name
  },
});








const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Limit file size to 5 MB
  fileFilter: (req, file, cb) => {
    const fileTypes = /jpeg|jpg|png|gif/;
    const extname = fileTypes.test(path.extname(file.originalname).toLowerCase());
    const mimeType = fileTypes.test(file.mimetype);

    if (extname && mimeType) {
      return cb(null, true);
    } else {
      return cb(new Error("Only image files are allowed (jpeg, jpg, png, gif)"), false);
    }
  },
});




// Define the User Schema


// const userSchema = new mongoose.Schema({
//   email: { type: String, required: true, unique: true, lowercase: true },
//   password: { type: String, required: true, minlength: 6 },
//   fullName: { type: String, required: true },
//   dob: { type: Date, required: true },
//   phone: { type: String, required: true, match: /^[0-9]{10}$/ },
//   createdAt: { type: Date, default: Date.now },
// });

// userSchema.index({ email: 1 }); 
// const User = mongoose.model("User", userSchema);



// Profile Schema and Model









//mera schremaa

// Product Schema and Model
// const productSchema = new mongoose.Schema({
//   id: { type: Number, default: 0 },
//   name: String,
//   price: String,
//   image: String,
//   description: String,
// });
// const ProductData = mongoose.model("products", productSchema, "products");





//shelinder bhai da schema

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





// Address Schema and Model


// const addressSchema = new mongoose.Schema({
//   name: String,
//   email: String,
//   phone: String,
//   address: String,
//   city: String,
//   state: String,
//   pin: String,
//   country: String,
//   isDefaultAddress: Boolean,
// });
// const Address = mongoose.model("Address", addressSchema);


























// Fetch Profile Data Route
app.get("/getProfile", async (req, res) => {
  const email = req.query.email;  // Get the email from the query parameters

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    // Find profile data by email
    const profile = await Profile.findOne({ email: email });

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
app.post("/saveProfile", upload.single("image"), async (req, res) => {
  try {
    const profileInfo = req.body;

    if (!profileInfo.name || !profileInfo.email) {
      return res.status(400).json({ message: "Name and email are required" });
    }

    const profileData = {
      name: profileInfo.name,
      email: profileInfo.email, 
      phone: profileInfo.phone,
      dob: profileInfo.dob,
      image: req.file ? req.file.path : "uploads/default-profile.png", // Default image fallback
    };

    const existingProfile = await Profile.findOne({ email: profileInfo.email });

    if (existingProfile) {
      // Update existing profile
      await Profile.updateOne({ email: profileInfo.email }, profileData);
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






// Product fetch route
// app.get("/products", async (req, res) => {
//   try {
//     const products = await ProductData.find({});
//     res.json(products);
//   } catch (error) {
//     console.error("Error fetching products:", error);
//     res.status(500).send("Error fetching products");
//   }
// });






// Save Address Route


// app.post("/address", async (req, res) => {
//   const { name, email, phone, address, city, state, pin, country, isDefaultAddress } = req.body;
//   if (!name || !email || !address || !city || !state || !pin || !country) {
//     return res.status(400).json({ message: "All address fields are required" });
//   }
//   try {
//     const newAddress = new Address({
//       name,
//       email,
//       phone,
//       address,
//       city,
//       state,
//       pin,
//       country,
//       isDefaultAddress,
//     });
//     const savedAddress = await newAddress.save();
//     res.status(201).json({ message: "Address saved successfully", savedAddress });
//   } catch (error) {
//     console.error("Error saving address:", error);
//     res.status(500).json({ message: "Internal Server Error", error: error.message });
//   }
// });




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









//shelinder bhai di api ans schema



//new api to add products in database
// Multer Configuration
// const storage = multer.diskStorage({
//   destination: (req, file, cb) => cb(null, 'uploads/'),
//   filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
// });



// const upload = multer({ storage });



// Product Routes


app.post('/products', upload.single('image'), async (req, res) => {
  try {
    const productData = {
      ...req.body,
      price: parseFloat(req.body.price),
      stock: parseInt(req.body.stock),
      discount: parseFloat(req.body.discount),
      image: req.file ? `/Photos/${req.file.filename}` : '',
    };
    const product = new Product(productData);
    await product.save();
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error creating product', error });
  }
});







//second porducts api


// Create Product
// app.post('/products', upload.single('image'), async (req, res) => {
//   try {
//     const imagePath = req.file ? `/uploads/${req.file.filename}` : "";
//     const product = new Product({ ...req.body, image: imagePath });
//     await product.save();
//     res.status(201).json(product);
//   } catch (error) {
//     res.status(500).json({ error: 'Error adding product' });
//   }
// });




app.get('/products', async (req, res) => {
  try {
    const products = await Product.find();
    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching products', error });
  }
});




app.get('/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.status(200).json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching product', error });
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
  } 
  catch (error) 
  {
    console.error("Error updating product status:", error);
    res.status(500).json({ message: 'Error updating product status', error });
  }
});








// User Schema & Model
const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  dob: { type: Date, required: true },
  password: { type: String, required: true }, // Add this field
  createdAt: { type: Date, default: Date.now },

  address: {
    street: String,
    city: String,
    postalCode: String,
    country: String
  },
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





// Order Schema & Model
// const orderSchema = new mongoose.Schema({
//   productName: String,
//   price: Number,
//   placedOn: Date,
//   status: String,
// });
// const Order = mongoose.model('Order', orderSchema);




//profile schema

const profileSchema = new mongoose.Schema({
  name: String,
  email: { type: String, required: true, unique: true },
  phone: String,
  dob: String,
  image: String, // Store image file path
});
profileSchema.index({ email: 1 }); 
const Profile = mongoose.model("Profile", profileSchema);




// My Login api

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    // Find user in User collection
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    // Check password
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ message: "Invalid password" });
    }

    // Find user profile to get the image
    const profile = await Profile.findOne({ email });

    // Return user profile data with image
    const userProfile = {
      name: user.name,
      email: user.email,
      dob: user.dob,
      phone: user.phone,
      image: profile?.image || null, // Get image from profile, or return null if not found
    };

    res.json({ message: "Login successful", userProfile });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});






// My Register api


app.post("/signup", async (req, res) => {
  const { email, password, name, dob, phone, image } = req.body;

  if (!email || !password || !name || !dob || !phone) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Create and save user
    const newUser = new User({ email, password: hashedPassword, name, dob, phone });
    await newUser.save();

    // Create and save profile with image
    const newProfile = new Profile({ email, name, phone, dob, image: image || "" });
    await newProfile.save();

    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});














// :white_tick: Email Transporter Setup (Fixed)
const transporter = nodemailer.createTransport({
  service: "gmail", // :white_tick: Correct service name
  auth: {
    user: process.env.EMAIL_USER, // :white_tick: Your email from .env
    pass: process.env.EMAIL_PASS, // :white_tick: App password (Not normal password)
  },
});





// :white_tick: Function to Send Email (Improved)
async function sendMail(to, subject, text, html) {
  try {
    const info = await transporter.sendMail({
      from: `"Anant Ki Drishti" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text,
      html,
    });
    console.log(":e-mail: Email sent successfully:", info.messageId);
    return { success: true, message: "Email sent successfully" };
  }

  catch (error) {

    console.error(":x: Error sending email:", error);
    return { success: false, message: "Failed to send email", error: error.message };
  }
}



// const profileSchema = new mongoose.Schema({
//   email: { type: String, required: true, unique: true },
//   password: { type: String, required: true },
// });

// const Profile = mongoose.model('profiles', profileSchema);
// :white_tick: Signup Route with Email & Notification





// app.post("/signup", async (req, res) => {
//   console.log("Received signup request:", req.body);

//   try {
//     const { email, password, fullName, dob, phone } = req.body;

//     // Validate input
//     if (!email || !password || !fullName || !dob || !phone) {
//       console.log("Signup error: Missing required fields");
//       return res.status(400).json({ success: false, message: "All fields are required" });
//     }

//     // Check if user already exists
//     const existingUser = await Profile.findOne({ email });
//     if (existingUser) {
//       return res.status(400).json({ success: false, message: "User already exists" });
//     }

//     // Create new user (storing plain password)
//     const newUser = new Profile({
//       email,
//       password, // Plain text password (Not recommended for production)
//       fullName,
//       dob,
//       phone
//     });

//     await newUser.save();
//     console.log("User registered successfully:", newUser);

//     // Send welcome email
//     const emailResponse = await sendMail(
//       email,
//       "Welcome to Anant ki Drishti",
//       "Hi, thank you for registering on Anant ki Drishti.",
//       "<p>Hi,</p><p>Thank you for registering on Anant ki Drishti.</p>"
//     );

//     if (!emailResponse.success) {
//       console.log("Signup warning: User registered, but email failed");
//       return res.status(500).json({ success: false, message: "User registered, but email sending failed" });
//     }

//     res.status(201).json({ success: true, message: "Signup successful, email sent" });

//   } catch (err) {
//     console.error("Signup error:", err);
//     res.status(500).json({ success: false, message: "Error during signup" });
//   }
// });






// :white_tick: Login Route


// app.post('/login', async (req, res) => {
//   console.log("Received login request:", req.body);
//   const { email, password } = req.body;
//   try {
//     if (!email || !password) {
//       return res.status(400).json({ success: false, message: "Email and password are required" });
//     }
//     const user = await Profile.findOne({ email });
//     if (!user) {
//       console.log("User not found:", email);
//       return res.status(400).json({ success: false, message: "User not found" });
//     }
//     if (user.password !== password) {
//       console.log("Invalid password for user:", email);
//       return res.status(400).json({ success: false, message: "Invalid password" });
//     }
//     console.log("User logged in successfully:", email);
//     return res.json({ success: true, message: "Login successful" });
//   } catch (err) {

//     console.error(":x: Login error:", err);
//     return res.status(500).json({ success: false, message: "Internal server error" });
//   }
// });




// Example route for dashboard (requires authentication)
app.get('/dashboard', (req, res) => {
  // In this case, we are not using JWT, but you can manually check session/cookie for authentication
  res.json({ success: true, message: 'Welcome to the dashboard!' });
});







// User Routes
app.get("/users", async (req, res) => {
  try {
    const users = await User.find({}); // Fetch all users
    if (!users || users.length === 0) {
      return res.status(404).json({ message: "No users found" });
    }
    res.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});



app.get("/users/:id", async (req, res) => {
  try {
    const userId = req.params.id;
    console.log("User ID:", userId);  // Log the received ID
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID format" });
    }
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});



app.post('/users', async (req, res) => {
  try {
    const newUser = new User(req.body);
    await newUser.save();
    res.status(201).json(newUser);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create user', error });
  }
});






//Shelinder bai Order Routes
// app.get('/orders', async (req, res) => {
//   try {
//     const orders = await Order.find();
//     res.status(200).json(orders);
//   } catch (error) {
//     res.status(500).json({ message: 'Failed to fetch orders', error });
//   }
// });



// app.put('/orders/:id', async (req, res) => {
//   try {
//     const order = await Order.findByIdAndUpdate(req.params.id, req.body, { new: true });
//     if (!order) {
//       return res.status(404).send('Order not found');
//     }
//     res.send(order);
//   } catch (err) {
//     res.status(500).send('Error updating order');
//   }
// });














//My order schema and api



const OrderSchema = new mongoose.Schema({
  orderId: String,
  customerName: String,
  customerEmail: String,
  customerPhone: String,
  address: String,
  cartItems: Array,
  totalAmount: Number,
  paymentStatus: String,
  transactionId: String,
  createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model("Order", OrderSchema);

// ✅ Example Cart and Address Schema (Assuming You Store Them)
const Cart = mongoose.model("Cart", new mongoose.Schema({
  userEmail: String,
  items: Array
}));

const Address = mongoose.model("Address", new mongoose.Schema({
  userEmail: String,
  fullAddress: String
}));

// ✅ Webhook to Capture Payment Success
app.post("/cashfree-webhook", async (req, res) => {
  try {
      const { order_id, reference_id, payment_status } = req.body;

      // Update order status in MongoDB
      const order = await Order.findOneAndUpdate(
          { _id: order_id },
          { payment_status, reference_id },
          { new: true }
      );

      if (!order) {
          return res.status(404).json({ success: false, message: "Order not found" });
      }

      res.json({ success: true, message: "Payment status updated", order });
  } catch (error) {
      console.error("Webhook error:", error);
      res.status(500).json({ success: false, message: "Server error" });
  }
});


app.get("/get-orders", async (req, res) => {
  try {
      const orders = await Order.find().sort({ createdAt: -1 });
      res.json({ success: true, orders });
  } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ success: false, message: "Server error" });
  }
});













// Start Server


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});



// Start HTTPS server


// https.createServer(options, app).listen(PORT, () => {
//   console.log(`Secure server running on HTTPS at port ${PORT}`);
// });
