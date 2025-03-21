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

const allowedOrigins = ['https://api.indraq.tech', 'https://indraq.tech', 'https://api.testindraq.com', 'https://testindraq.com'];
// :white_tick: CORS Middleware
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (e.g., mobile apps, curl)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true, // REQUIRED for cookies/auth headers
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS","PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

// app.use(cors({
//   origin: '*',  // Update this to match your Go Live URL if different
//   methods: ['GET', 'POST', 'PUT', 'DELETE'],
//   allowedHeaders: ['Content-Type', 'Authorization']
// }))
app.use(express.json());

const frontendPath = path.join(__dirname, "..", "Frontend"); // Adjust if needed
app.use(express.static(path.join(__dirname, frontendPath)));
app.use(express.static(frontendPath));
app.use(bodyParser.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const PORT = process.env.PORT || 4000


// origin: ['https://indraq.tech', 'http://localhost:3001'] ,  // Allow requests from localhost:3001
// methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
// allowedHeaders: ["Content-Type", "Authorization"], // Add headers if needed
// credentials: true,  // Allow cookies/credentials




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
const generateOrderId = async () => {
  const lastOrder = await User.aggregate([
    { $unwind: "$orders" },
    { $project: { numericOrderId: { $toInt: { $substr: ["$orders.orderId", 3, -1] } } } },
    { $sort: { numericOrderId: -1 } },
    { $limit: 1 }
  ]);

  let newOrderId = "ORD001";
  if (lastOrder.length > 0) {
    const lastOrderId = lastOrder[0].numericOrderId;
    newOrderId = `ORD${(lastOrderId + 1).toString().padStart(3, "0")}`;
  }

  console.log("Generated orderId:", newOrderId);
  return newOrderId;
};



// Create Payment Link & Save Order with linkId
app.post("/create-payment-link", async (req, res) => {
  try {
    let { 
      userId, 
      customer_name, 
      customer_email, 
      customer_phone, 
      amount,
      shippingMethod,
      deliveryAddress // Added delivery address
    } = req.body;

    if (!userId || !customer_name || !customer_email || !customer_phone || !amount || !deliveryAddress) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    customer_phone = String(customer_phone);

    // ✅ Generate order ID
    const orderId = await generateOrderId();
    const linkId = `CF_${crypto.randomBytes(8).toString("hex")}`;

    const payload = {
      order_id: orderId,
      link_id: linkId,
      customer_details: { customer_name, customer_email, customer_phone },
      link_amount: amount,
      link_currency: "INR",
      link_purpose: "E-commerce Purchase",
      link_notify: { send_email: true, send_sms: true },
      link_auto_reminders: true,
      link_expiry_time: new Date(Date.now() + 3600 * 1000).toISOString(),
      link_meta: {
        // return_url: `http://127.0.0.1:5501/Frontend/redirect.html?orderId=${orderId}&linkId=${linkId}&userId=${userId}`,
        return_url: `https://indraq.tech/redirect.html?orderId=${orderId}&linkId=${linkId}&userId=${userId}`,
      },
    };

    const response = await axios.post("https://sandbox.cashfree.com/pg/links", payload, {
      headers: {
        "x-api-version": "2022-09-01",
        "x-client-id": APP_ID,
        "x-client-secret": SECRET_KEY,
      },
    });

    // ✅ Save Order to MongoDB with delivery address
    const newOrder = {
      orderId,
      linkId,
      orderDetails: [],
      price: amount,
      shippingMethod: shippingMethod || "standard",
      deliveryAddress: {
        fullName: deliveryAddress.fullName,
        phone: deliveryAddress.phone,
        email: deliveryAddress.email,
        street: deliveryAddress.street,
        city: deliveryAddress.city,
        postalCode: deliveryAddress.postalCode,
        state: deliveryAddress.state,
        country: deliveryAddress.country,
      },
      // Add the delivery address
      paymentDetails: { status: "pending" },
      status: "pending",
      createdAt: new Date(),
    };

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $push: { orders: newOrder } },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ success: true, userId, orderId, linkId, linkUrl: response.data.link_url });
  } catch (error) {
    console.error("Cashfree Error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to create payment link" });
  }
});



// Check Payment Status & Update Order
app.get("/check-payment-status", async (req, res) => {
  try {
    const { userId, orderId, linkId } = req.query;

    if (!userId || !orderId || !linkId) {
      return res.status(400).json({ error: "Missing userId, orderId, or linkId" });
    }

    // Find the user with the matching order
    const user = await User.findOne({ _id: userId, "orders.orderId": orderId, "orders.linkId": linkId });

    if (!user) {
      return res.status(404).json({ error: "User or Order not found" });
    }

    const order = user.orders.find((o) => o.orderId === orderId && o.linkId === linkId);

    console.log(`Checking payment status for Order: ${orderId}, Link ID: ${linkId}`);

    // Fetch payment status from Cashfree
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

    // ✅ Update the order inside the user's `orders` array
    await User.updateOne(
      { _id: userId, "orders.orderId": orderId },
      {
        $set: {
          "orders.$.status": orderStatus,
          "orders.$.paymentDetails.status": paymentStatus,
          "orders.$.paymentDetails.paid": paid,
          "orders.$.paymentDetails.transactionId": cashfreeResponse.data.reference_id || "",
          "orders.$.paymentDetails.timestamp": new Date(),
        },
      }
    );
    ;


    res.json({ success: orderStatus === "successful", status: orderStatus });
  } catch (error) {
    console.error("Error checking payment status:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to check payment status" });
  }
});








// Serve Static Pages
app.get("/redirect.html", (req, res) => res.sendFile(path.join(frontendPath, "redirect.html")));
app.get("/success.html", (req, res) => res.sendFile(path.join(frontendPath, "/success.html")));
app.get("/failure.html", (req, res) => res.sendFile(path.join(frontendPath, "failure.html")));





app.post("/users/:id/orders", async (req, res) => {
  try {
    const { id } = req.params;
    const newOrder = req.body;

    // ❌ Remove `_id` if it exists (MongoDB will generate it automatically)
    if (newOrder._id) delete newOrder._id;

    console.log("Received User ID:", id);
    console.log("Processed Order:", JSON.stringify(newOrder, null, 2));

    // Ensure delivery address is present
    if (!newOrder.deliveryAddress) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing delivery address information" 
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $push: { orders: newOrder } },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    console.log("Order saved successfully for user:", id);
    res.status(200).json({ success: true, message: "Order saved", order: newOrder });
  } catch (error) {
    console.error("Error saving order:", error);
    res.status(500).json({ success: false, message: "Error saving order", error: error.message });
  }
});



app.get("/users/:id/orders", async (req, res) => {
  const { id } = req.params;

  try {
    const user = await User.findById(id, { orders: 1 });

    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json({ orders: user.orders || [] });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});




const userSchema = new mongoose.Schema({
  profileImage: { type: String, default: "" },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true, index: true },
  phone: { type: String, required: true },
  password: { type: String, required: true },
  dob: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },

  address: [
    {
      fullName: { type: String, required: true },
      phone: { type: String, required: true },
      email: { type: String, required: true },
      street: { type: String, required: true },
      city: { type: String, required: true },
      postalCode: { type: String, required: true },
      state: { type: String, required: true },
      country: { type: String, required: true },
    },
  ],

  orders: [
    {
      orderId: { type: String, required: true, unique: true }, // Custom Order ID
      linkId: String,
      orderDetails: Array,
      price: { type: Number, required: true, min: 0 },
      shippingMethod: { type: String, default: "standard" },
      deliveryAddress: {
        fullName: String,
        phone: String,
        email: String,
        street: String,
        city: String,
        postalCode: String,
        state: String,
        country: String
      },
      paymentDetails: {
        method: String,
        transactionId: String,
        status: { type: String, default: "pending" },
        paid: { type: Boolean, default: false },
        timestamp: Date,
      },
      status: { type: String, default: "pending" },
      createdAt: { type: Date, default: Date.now },
    },
  ],
});

const User = mongoose.model("users", userSchema);


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



app.put("/users/:id", async (req, res) => {
  try {
    const { firstName, lastName, phone, address } = req.body;

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { firstName, lastName, phone, address },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(updatedUser);
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


app.put("/users/:id/update", async (req, res) => {
  try {
      const { firstName, lastName, phone } = req.body;
      const updatedUser = await User.findByIdAndUpdate(
          req.params.id,
          { firstName, lastName, phone },
          { new: true }
      );
      if (!updatedUser) return res.status(404).json({ message: "User not found" });
      res.json(updatedUser);
  } catch (error) {
      res.status(500).json({ message: "Error updating profile", error });
  }
});


// app.get("/users/:id", async (req, res) => {
//   try {
//     const user = await User.findById(req.params.id);

//     if (!user) {
//       return res.status(404).json({ message: "User not found" });
//     }

//     res.json(user);
//   } catch (error) {
//     console.error("Error fetching user:", error);
//     res.status(500).json({ error: "Internal Server Error" });
//   }
// });






app.put("/users/:id/update-address/:addressId", async (req, res) => {
  try {
    const userId = req.params.id;
    const addressId = req.params.addressId;
    
    // Log the request data for debugging
    console.log("Update Address Request:", {
      userId,
      addressId,
      body: req.body
    });

    // Check if all required fields are present
    const { fullName, phone, email, street, city, postalCode, state, country } = req.body;
    
    if (!fullName || !phone || !email || !street || !city || !postalCode || !state || !country) {
      return res.status(400).json({ 
        message: "Missing required address fields",
        requiredFields: ["fullName", "phone", "email", "street", "city", "postalCode", "state", "country"]
      });
    }

    // Use findOneAndUpdate with the positional $ operator
    const result = await User.findOneAndUpdate(
      { 
        _id: userId, 
        "address._id": addressId 
      },
      {
        $set: {
          "address.$": req.body
        }
      },
      { new: true }
    );

    if (!result) {
      return res.status(404).json({ message: "User or address not found" });
    }

    res.json({ 
      message: "Address updated successfully!", 
      addresses: result.address 
    });
  } catch (error) {
    console.error("Error updating address:", error);
    res.status(500).json({ 
      message: "Error updating address", 
      error: error.message 
    });
  }
});

// Remove a Specific Address
app.put("/users/:id/remove-address/:addressId", async (req, res) => {
  try {
    const userId = req.params.id;
    const addressId = req.params.addressId;
    
    // Log the request data for debugging
    console.log("Remove Address Request:", {
      userId,
      addressId
    });

    // Use mongoose's $pull operator to remove the address
    const result = await User.findByIdAndUpdate(
      userId,
      {
        $pull: {
          address: { _id: addressId }
        }
      },
      { new: true }
    );

    if (!result) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if the address was actually removed
    const addressWasRemoved = result.address.every(addr => addr._id.toString() !== addressId);
    
    if (!addressWasRemoved) {
      return res.status(404).json({ message: "Address not found or could not be removed" });
    }

    res.json({ 
      message: "Address removed successfully!", 
      addresses: result.address 
    });
  } catch (error) {
    console.error("Error removing address:", error);
    res.status(500).json({ 
      message: "Error removing address", 
      error: error.message 
    });
  }
});


// Ensure `uploads/Userprofile/` folder exists
const uploadDir = path.join(__dirname, "uploads/Userprofile");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const userStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const uploadProfile = multer({ storage: userStorage });

// Upload Profile Image and Update User
app.post("/users/:id/upload", uploadProfile.single("profileImage"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const imageUrl = `/uploads/Userprofile/${req.file.filename}`;

    await User.findByIdAndUpdate(id, { profileImage: imageUrl });

    res.json({ message: "Profile image updated!", imageUrl });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/users/:id/profile", async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);

    if (!user || !user.profileImage) {
      return res.status(404).json({ error: "User or profile image not found" });
    }

    res.json({ imageUrl: `http://localhost:4000${user.profileImage}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

// Update User Profile API
app.put("/users/:id", uploadProfile.single("profileImage"), async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, phone } = req.body;
    const profileImage = req.file ? `/uploads/Userprofile/${req.file.filename}` : undefined;

    const updateFields = { firstName, lastName, phone };
    if (profileImage) updateFields.profileImage = profileImage;

    const updatedUser = await User.findByIdAndUpdate(id, { $set: updateFields }, { new: true });

    if (!updatedUser) return res.status(404).json({ message: "User not found" });

    res.json(updatedUser);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});













// Order Schema
// const orderSchema = new mongoose.Schema({
//   orderId: { type: String, unique: true }, // Custom Order ID
//   linkId: String,
//   customerName: String,
//   customerEmail: String,
//   customerPhone: String,
//   orderDetails: Array,
//   Price: Number,
//   paymentDetails: {
//     method: String,
//     transactionId: String,
//     status: { type: String, default: 'pending' }, // Payment status
//     paid: { type: Boolean, default: false }, // New field indicating if payment is made
//     timestamp: Date
//   },
//   status: { type: String, default: 'pending' },  // New field for order status
//   createdAt: { type: Date, default: Date.now }
// });

// const Order = mongoose.model("Order", orderSchema);



// app.get('/get-orders', async (req, res) => {
//   try {
//     // Fetch all orders from the database
//     const orders = await Order.find({});

//     // Return the orders
//     res.json({ success: true, orders });
//   } catch (error) {
//     console.error("Error fetching orders:", error);
//     res.status(500).json({ success: false, message: 'Failed to fetch orders' });
//   }
// });






app.get("/users/email/:email", async (req, res) => {
  const user = await User.findOne({ email: req.params.email });
  if (!user) return res.status(404).send("User not found");
  res.json(user);
});



app.post("/users/:id/add-address", async (req, res) => {
  const { id } = req.params;
  const newAddress = req.body;

  try {
    const user = await User.findByIdAndUpdate(
      id,
      { $push: { address: newAddress } },
      { new: true }
    );

    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json({ message: "Address added successfully", user });
  } catch (error) {
    console.error("Error adding address:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/users/:id/addresses", async (req, res) => {
  const { id } = req.params;

  try {
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json({ addresses: user.address || [] });
  } catch (error) {
    console.error("Error fetching addresses:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});








// app.get('/getUser', async (req, res) => {
//   const { email } = req.query;
//   try {
//     const user = await User.findOne({ email }).select("-password"); // Exclude password
//     if (!user) return res.status(404).json({ message: "User not found" });
//     res.json(user);
//   } catch (error) {
//     res.status(500).json({ message: "Server error" });
//   }
// });









// ✅ Signup Route
app.post("/signup", async (req, res) => {
  try {
    const { firstName, lastName, email, password, phone } = req.body;

    if (!firstName || !lastName || !email || !password || !phone) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Check if user exists with the same email
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ message: "User with this email already exists" });
    }

    // Check if user exists with the same phone number
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
      return res.status(400).json({ message: "User with this phone number already exists" });
    }

    const newUser = new User({ firstName, lastName, email, password, phone });
    await newUser.save();

    res.status(201).json({
      message: "User registered successfully",
      user: {
        _id: newUser._id,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        email: newUser.email,
        phone: newUser.phone,
        profileImage: newUser.profileImage,
        dob: newUser.dob,
      },
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});
// ✅ Login Route
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    if (user.password !== password) {
      return res.status(400).json({ message: "Invalid password" });
    }

    res.status(200).json({
      message: "Login successful",
      userProfile: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        profileImage: user.profileImage,
        dob: user.dob,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
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





// // Product Schema & Model
// const productSchema = new mongoose.Schema({
//   name: String,
//   description: String,
//   image: String,
//   price: Number,
//   stock: Number,
//   status: { type: String, enum: ['available', 'out of stock'], default: 'available' },
//   category: String,
//   discount: Number,
//   size: String,
//   color: String,
// });
// const Product = mongoose.model('products', productSchema);




// // Configure multer for file uploads
// const storage = multer.diskStorage({
//   destination: function (req, file, cb) {
//     cb(null, 'uploads/Products/');
//   },
//   filename: function (req, file, cb) {
//     cb(null, file.originalname);
//   }
// });

// const upload = multer({ storage: storage });





// app.get('/products', async (req, res) => {
//   try {
//     let query = {};
//     let limit = parseInt(req.query.limit) || 0; // Convert limit to a number, default 0 (no limit)

//     const products = await Product.find(query).limit(limit);
//     res.json(products);
//   } catch (error) {
//     res.status(500).json({ error: 'Failed to fetch products' });
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


// Create Product
app.post('/products', upload.single('image'), async (req, res) => {
  try {
    console.log(":inbox_tray: Incoming Request Body:", req.body);
    console.log(":outbox_tray: Uploaded File:", req.file);
    if (!req.body.name || !req.body.price || !req.body.category) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Image upload failed" });
    }
    const imagePath = `/uploads/Products/${req.file.originalname}`;
    const product = new Product({ ...req.body, image: imagePath });
    await product.save();
    res.status(201).json(product);
  } catch (error) {
    console.error(":x: Error adding product:", error);
    res.status(500).json({ error: "Error adding product", details: error.message });
  }
});


// Product fetch route
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
      imagePath = `/uploads/Products/${req.file.originalname}`; // :white_tick: Store new image in correct folder
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






// Order Schema (similar to previous example)
const orderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true },
  userName: String,
  address: String,
  productName: String,
  productImage: String,
  price: Number,
  quantity: Number,
  status: {
    type: String,
    enum: ['Pending', 'Processing', 'Shipped', 'Delivered', 'Canceled'],
    default: 'Pending'
  },
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);
// GET Orders with Filtering
app.get('/orders', async (req, res) => {
  try {
    const { name, priceRange, size, color, quantity, category } = req.query;
    console.log('Filters:', { name, priceRange, size, color, category });
    const filter = {};
    if (name) filter.userName = { $regex: name, $options: 'i' };
    if (priceRange) {
      const [min, max] = priceRange.split('-');
      filter.price = { $gte: min, $lte: max };
    }
    if (size) filter.size = size;
    if (color) filter.color = color;
    if (category) filter.category = category;
    console.log('Filter:', filter);  // Check filter values
    const orders = await Order.find(filter);
    res.json(orders);
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ message: err.message });
  }
});
// Create Order
app.post('/orders', upload.single('image'), async (req, res) => {
  try {
    console.log("Received file:", req.file); // Debugging
    console.log("Received body:", req.body); // Debugging
    if (!req.file) {
      return res.status(400).json({ error: "Order image upload failed" });
    }
    const lastOrder = await Order.findOne().sort({ createdAt: -1 });
    let lastCount = 0;
    if (lastOrder && lastOrder.orderId) {
      const countStr = lastOrder.orderId.substring(6, 9);
      lastCount = parseInt(countStr, 10) || 0;
    }
    const newCount = lastCount + 1;
    const newCountStr = newCount.toString().padStart(3, '0');
    const now = new Date();
    const dateTimeStr = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
    const newOrderId = `Anant${newCountStr}${dateTimeStr}`;
    const imagePath = `/uploads/Products/${req.file.originalname}`;
    const { userName, address, productName, price, size, quantity } = req.body;
    if (!userName || !address || !productName || !price || !size || !quantity) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const newOrder = new Order({
      orderId: newOrderId,
      userName,
      address,
      productName,
      productImage: imagePath,
      price,
      size,
      quantity
    });
    await newOrder.save();
    res.status(201).json(newOrder);
  } catch (err) {
    console.error("Error creating order:", err);
    res.status(500).json({ message: err.message });
  }
});
// Update Order Status
app.patch('/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    // Validate that the status is one of the allowed values
    const allowedStatuses = ['Pending', 'Completed', 'Shipped', 'Canceled', 'Processing'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    res.json(order);
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ message: error.message });
  }
});
// Update Order Details
app.put('/orders/:id', async (req, res) => {
  try {
    const { address, discount, productImage } = req.body;
    // Validate the fields before updating
    const updateFields = {};
    if (address) updateFields.address = address;
    if (discount) updateFields.discount = discount;
    if (productImage) updateFields.productImage = productImage;
    const order = await Order.findByIdAndUpdate(req.params.id, updateFields, { new: true });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    res.json(order);
  } catch (err) {
    console.error('Error updating order details:', err);
    res.status(500).json({ message: err.message });
  }
});
// Delete Order
app.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deletedOrder = await Order.findByIdAndDelete(id);
    if (!deletedOrder) {
      return res.status(404).json({ message: 'Order not found' });
    }
    res.json({ message: 'Order deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});











// app.post("/update-profile", async (req, res) => {
//   const { email, firstName, lastName, phone, dob, gender } = req.body;

//   try {
//     // Find user by email
//     const user = await User.findOne({ email });

//     if (!user) {
//       return res.status(404).json({ message: "User not found" });
//     }

//     // Update user details
//     user.firstName = firstName;
//     user.lastName = lastName;
//     user.phone = phone;
//     user.dob = dob;
//     user.gender = gender
//     // user.address = address; // Replace existing address array

//     // Save updated user
//     await user.save();

//     res.status(200).json({ message: "Profile updated successfully", user });
//   } catch (error) {
//     console.error("Error updating profile:", error);
//     res.status(500).json({ message: "Server error" });
//   }
// });




// // API Route to Update Profile Image
// app.post("/upload-profile-image", uploadProfile.single("profileImage"), async (req, res) => {
//   try {
//     const { email } = req.body; // Get email from request
//     if (!req.file) return res.status(400).json({ message: "No file uploaded" });

//     // Find user and update profile image
//     const updatedUser = await User.findOneAndUpdate(
//       { email },
//       { profileImage: `/uploads/Userprofile/${req.file.filename}` }, // Corrected image path
//       { new: true }
//     );

//     if (!updatedUser) return res.status(404).json({ message: "User not found" });

//     res.status(200).json({ message: "Profile image updated", user: updatedUser });
//   } catch (error) {
//     console.error("Error uploading image:", error);
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// });





// Start Server

// app.listen(PORT, () => {
//   console.log(`Server running on http://localhost:${PORT}`);
// });



// Start HTTPS server

https.createServer(options, app).listen(PORT, () => {
  console.log(`Secure server running on HTTPS at port ${PORT}`);
});
