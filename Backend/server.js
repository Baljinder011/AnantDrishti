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
const fs = require("fs");
const dotenv = require("dotenv")
dotenv.config();
const nodemailer = require("nodemailer")
const { Server } = require("socket.io")
const http = require("http")
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



// Check if running on VPS or locally
const isProduction = process.env.NODE_ENV === "production";
let server; // Declare the server variable
if (isProduction) {
  let options;
  try {
    options = {
      key: fs.readFileSync(path.join(__dirname, "/etc/letsencrypt/live/indraq.tech/privkey.pem")),
      cert: fs.readFileSync(path.join(__dirname, "/etc/letsencrypt/live/indraq.tech/fullchain.pem")),
    };
    server = https.createServer(options, app); // Use the correct options object
    console.log(":white_tick: Running in PRODUCTION mode with HTTPS");
  } catch (error) {
    console.error(":x: Error loading SSL certificates:", error.message);
    process.exit(1);
  }
} else {
  server = http.createServer(app); // Use HTTP for local development
  console.log(":white_tick: Running in DEVELOPMENT mode with HTTP");
}


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







// // :white_tick: Initialize WebSocket Server
const io = new Server(server, {
  cors: {
    origin: "https://testindraq.com",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});
// :white_tick: Handle WebSocket Connections
let connectedAdmins = [];
io.on("connection", (socket) => {
  console.log(":white_tick: Admin connected for notifications:", socket.id);
  connectedAdmins.push(socket);
  socket.on("disconnect", () => {
    console.log(":x: Admin disconnected:", socket.id);
    connectedAdmins = connectedAdmins.filter((admin) => admin.id !== socket.id);
  });
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
      from: `"AnantDrishti" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text,
      html,
    });
    console.log(":e-mail: Email sent successfully:", info.messageId);
    return { success: true, message: "Email sent successfully" };
  } catch (error) {
    console.error(":x: Error sending email:", error);
    return { success: false, message: "Failed to send email", error: error.message };
  }
}















// Cashfree API Credentials
const APP_ID = process.env.CASHFREE_APP_ID || "YOUR_APP_ID";
const SECRET_KEY = process.env.CASHFREE_SECRET_KEY || "YOUR_SECRET_KEY";




// User Schema
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
  loginSessions: [
    {
      date: String,
      time: String,
      location: String
    }
  ],

  orders: [
    {
      orderId: { type: String, required: true, unique: true },
      linkId: String,
      orderDetails: Array,
      price: { type: Number, required: true, min: 0 },
      shippingMethod: { type: String, default: "standard" },
      shippingPrice: { type: Number, default: 0 },
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
      deliveryStatus: { type: String, default: "processing" },
      createdAt: { type: Date, default: Date.now },
    },
  ],
});

const User = mongoose.model("users", userSchema);



app.post("/users/:id/orders", async (req, res) => {
  try {
    const { id } = req.params;
    let {
      customer_name,
      customer_email,
      customer_phone,
      amount,
      shippingMethod,
      shippingCharge,  // Explicitly receive this
      deliveryAddress,
      deliveryStatus,
      orderDetails
    } = req.body;
    // Explicitly define shipping prices
    const shippingPrices = {
      standard: 100,
      express: 300,
      default: 0  // Added a default price
    };
    const shippingPrice = shippingMethod && shippingPrices[shippingMethod]
      ? shippingPrices[shippingMethod]
      : (shippingCharge || shippingPrices.default);
    console.log("Shipping Method:", shippingMethod);
    console.log("Shipping Prices:", shippingPrices);
    console.log("Calculated Shipping Price:", shippingPrice);
    console.log("Shipping Details:", {
      method: shippingMethod,
      charge: shippingCharge,
      calculatedPrice: shippingPrice
    });

    if (!id || !customer_name || !customer_email || !customer_phone || !amount || !deliveryAddress) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    customer_phone = String(customer_phone);
    // Generate orderId
    const lastOrder = await Order.findOne().sort({ createdAt: -1 });
    let newOrderId = "ORD001";
    if (lastOrder) {
      const match = lastOrder.orderId.match(/ORD(\d+)/);
      if (match) {
        newOrderId = `ORD${String(parseInt(match[1], 10) + 1).padStart(3, "0")}`;
      }
    }
    // Generate payment link ID
    const linkId = `CF_${crypto.randomBytes(8).toString("hex")}`;
    // Cashfree payment link payload
    const payload = {
      order_id: newOrderId,
      link_id: linkId,
      customer_details: { customer_name, customer_email, customer_phone },
      link_amount: amount,
      link_currency: "INR",
      link_purpose: "E-commerce Purchase",
      link_notify: { send_email: true, send_sms: true },
      link_auto_reminders: true,
      link_expiry_time: new Date(Date.now() + 3600 * 1000).toISOString(),
      link_meta: {
        // return_url: `http://127.0.0.1:5501/Frontend/redirect.html?orderId=${newOrderId}&linkId=${linkId}&userId=${id}`
        return_url: `https://indraq.tech/redirect.html?orderId=${newOrderId}&linkId=${linkId}&userId=${id}`
      },
    };
    // Call Cashfree API to generate payment link
    const response = await axios.post("https://sandbox.cashfree.com/pg/links", payload, {
      headers: {
        "x-api-version": "2022-09-01",
        "x-client-id": APP_ID,
        "x-client-secret": SECRET_KEY,
      },
    });
    if (!response.data || !response.data.link_url) {
      return res.status(500).json({ error: "Failed to generate payment link" });
    }
    // Create new order object
    const newOrder = {
      orderId: newOrderId,
      userId: id,
      linkId,
      orderDetails,
      price: amount,
      shippingMethod: shippingMethod || "standard",
      shippingPrice: shippingPrice, // EXPLICITLY set shipping price
      deliveryAddress,
      paymentDetails: { status: "pending", transactionId: "", paid: false },
      deliveryStatus: "processing",
      createdAt: new Date(),
    };
    // Save order to `orders` collection
    const savedOrder = await Order.create(newOrder);
    // Save order reference in user's orders array
    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $push: { orders: savedOrder } },
      { new: true }
    );
    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }
    // :white_tick: Populate User Details for Notification
    const populatedOrder = await Order.findById(savedOrder._id).populate("userId", "firstName lastName email");
    // :bell: **Send Real-Time WebSocket Notification**
    io.emit("newOrder", populatedOrder);
    console.log(":package: New Order Notification Sent:", populatedOrder);
    // :white_tick: Send Response
    res.json({
      success: true,
      userId: id,
      orderId: newOrderId,
      linkId,
      linkUrl: response.data.link_url,
      message: "Order created successfully, waiting for payment",
    });
  } catch (error) {
    console.error(":x: Error:", error.response?.data || error.message);
    res.status(500).json({ error: "Error processing order", details: error.message?.data || error.message });
  }
});





// Order Schema
const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "users", required: true },
  linkId: String,
  orderDetails: Array,
  price: { type: Number, required: true, min: 0 },
  shippingMethod: { type: String, default: "standard" },
  shippingPrice: { type: Number, default: 0 },
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
  deliveryStatus: { type: String, default: "processing" },
  createdAt: { type: Date, default: Date.now },
});

const Order = mongoose.model("orders", orderSchema);









// Update Order Status from Orders Collection
app.put("/orders/update-status", async (req, res) => {
  const { orderId, newStatus } = req.body;

  if (!orderId || !newStatus) {
      return res.status(400).json({ error: "Missing required fields" });
  }

  try {
      // Update the order in the orders collection
      const updatedOrder = await Order.findOneAndUpdate(
          { orderId },
          { deliveryStatus: newStatus },
          { new: true }
      );

      if (!updatedOrder) {
          return res.status(404).json({ error: "Order not found" });
      }

      // Update the order in the user's embedded orders array
      const updatedUser = await User.findOneAndUpdate(
          { _id: updatedOrder.userId, "orders.orderId": orderId },
          { $set: { "orders.$.deliveryStatus": newStatus } },
          { new: true }
      );

      if (!updatedUser) {
          return res.status(404).json({ error: "User order not found" });
      }

      res.json({ message: "Order status updated successfully!", updatedOrder });

  } catch (error) {
      console.error("Error updating order status:", error);
      res.status(500).json({ error: "Internal server error" });
  }
});


// Update Order Status from Users Collection
app.put("/users/:userId/orders/:orderId/status", async (req, res) => {
  const { userId, orderId } = req.params;
  const { newStatus } = req.body;

  if (!newStatus) {
    return res.status(400).json({ error: "New status is required" });
  }

  try {
    // Update in Users collection
    const userUpdate = await User.findOneAndUpdate(
      { 
        _id: userId, 
        "orders.orderId": orderId 
      },
      { 
        $set: { "orders.$.deliveryStatus": newStatus } 
      },
      { new: true }
    );

    if (!userUpdate) {
      return res.status(404).json({ error: "User or Order not found" });
    }

    // Sync with Orders collection
    await Order.findOneAndUpdate(
      { orderId: orderId },
      { deliveryStatus: newStatus },
      { new: true }
    );

    res.json({ 
      message: "Order status updated successfully", 
      updatedOrder: userUpdate.orders.find(order => order.orderId === orderId)
    });

  } catch (error) {
    console.error("Error updating order status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Fetch Order Statuses for a User
app.get("/users/:userId/orders/status", async (req, res) => {
  const { userId } = req.params;

  try {
    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Fetch latest statuses from Orders collection
    const updatedOrders = await Order.find({
      userId: userId
    }).select('orderId deliveryStatus');

    res.json(updatedOrders);
  } catch (error) {
    console.error("Error fetching order status updates:", error);
    res.status(500).json({ error: "Internal server error" });
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

    // Update the order inside the user's `orders` array
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

    // ✅ Add this block to update the Order collection
    await Order.updateOne(
      { orderId: orderId, linkId: linkId },
      {
        $set: {
          status: orderStatus,
          'paymentDetails.status': paymentStatus,
          'paymentDetails.paid': paid,
          'paymentDetails.transactionId': cashfreeResponse.data.reference_id || "",
          'paymentDetails.timestamp': new Date(),
        },
      }
    );

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

// Fetch Login Sessions of a User
app.get("/users/:id/loginsessions", async (req, res) => {
  try {
    const user = await User.findById(req.params.id, "loginSessions");
    res.json(user.loginSessions || []);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch login sessions" });
  }
});


app.put("/users/:id", async (req, res) => {
  const userId = req.params.id;
  const updatedUserData = req.body;
  try {
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updatedUserData },
      { new: true, runValidators: true }
    );
    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json(updatedUser);
  } catch (error) {
    res.status(500).json({ message: "Failed to update user", error: error.message });
  }
});




// // :white_tick: Update Personal Details
app.put("/:id/personal", async (req, res) => {
  try {
    const { firstName, lastName, email, phone } = req.body;
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { firstName, lastName, email, phone },
      { new: true }
    );
    if (!updatedUser) return res.status(404).json({ error: "User not found" });
    res.json(updatedUser);
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).json({ error: "Failed to update personal details." });
  }
});
// // :white_tick: Update Address
app.put("/:id/address", async (req, res) => {
  try {
    const { fullName, phone, email, street, city, postalCode, state, country } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    user.address[0] = { fullName, phone, email, street, city, postalCode, state, country };
    await user.save();
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: "Failed to update address." });
  }
});
// // :white_tick: Update Login Sessions
app.put("/:id/loginSessions", async (req, res) => {
  try {
    const { index, date, time, location } = req.body;
    const user = await User.findById(req.params.id);
    if (!user || !user.loginSessions[index]) return res.status(404).json({ error: "Login session not found" });
    user.loginSessions[index] = { date, time, location };
    await user.save();
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: "Failed to update login session." });
  }
});
// // :white_tick: Update Orders
app.put("/:id/orders", async (req, res) => {
  try {
    const { index, orderId, price, status } = req.body;
    const user = await User.findById(req.params.id);
    if (!user || !user.orders[index]) return res.status(404).json({ error: "Order not found" });
    user.orders[index] = { ...user.orders[index], orderId, price, status };
    await user.save();
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: "Failed to update order." });
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

// Fetch Address Details of a User
app.get("/users/:id/address", async (req, res) => {
  try {
    const user = await User.findById(req.params.id, "address");
    res.json(user.address || []);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch address details" });
  }
});


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



    // :white_tick: Send Welcome Email
    const emailResponse = await sendMail(
      email,
      "Welcome to AnantDrristi",
      "Hi, thank you for registering on AnantDrristi.",
      "<p>Hi,</p><p>Thank you for registering on AnantDrristi.</p>"
    );
    if (!emailResponse.success) {
      return res.json({ success: false, message: "User registered, but email failed" });
    }
    // :white_tick: Emit real-time notification to connected admins
    io.emit("newUser", { message: `New user ${firstName} ${lastName} is registered.` })
    console.log(":bell: Notification Sent:", `New user ${firstName} ${lastName} registered!`);




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
app.get('/products', async (req, res) => {
  try {
    let query = {};
    let limit = parseInt(req.query.limit) || 0; // Convert limit to a number, default 0 (no limit)

    const products = await Product.find(query).limit(limit);
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch products' });
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











app.get("/orders", async (req, res) => {
  try {
    const orders = await Order.find().populate("userId", "name email");
    res.json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});


// Update Order Status
app.patch('/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    console.log('Received status update:', {
      orderId: req.params.id,
      newStatus: status
    });
    // Validate that the status is one of the allowed values
    const allowedStatuses = ['Pending', 'Completed', 'Shipped', 'Canceled', 'Processing'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { deliveryStatus: status },
      {
        new: true,
        runValidators: true
      }
    );
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    console.log('Updated order:', order);
    res.json(order);
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({
      message: 'Internal server error',
      error: error.message
    });
  }
});

app.get("/order-status/:orderId", async (req, res) => {
  try {
      const { orderId } = req.params;

      // Fetch order from the database
      const order = await Order.findOne({ orderId });

      if (!order) {
          return res.status(404).json({ message: "Order not found" });
      }

      res.json({ deliveryStatus: order.deliveryStatus });
  } catch (error) {
      console.error("Error fetching delivery status:", error);
      res.status(500).json({ message: "Internal server error" });
  }
});







// Update Order Details
app.put('/orders/:id', async (req, res) => {
  try {
    const { address } = req.body;
    console.log('Received order update:', {
      orderId: req.params.id,
      address
    });
    // Validate the update
    if (!address) {
      return res.status(400).json({ message: 'Address is required' });
    }
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      {
        deliveryAddress: {
          ...address,
          street: address.street // Explicitly update street
        }
      },
      {
        new: true,
        runValidators: true
      }
    );
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    console.log('Updated order:', order);
    res.json(order);
  } catch (error) {
    console.error('Error updating order details:', error);
    res.status(500).json({
      message: 'Internal server error',
      error: error.message
    });
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




server.listen(PORT, () => {
  console.log(`:rocket: Server running on ${isProduction ? "HTTPS" : "HTTP"} at port ${PORT}`);
});




// Start Server

// app.listen(PORT, () => {
//   console.log(`Server running on http://localhost:${PORT}`);
// });



// Start HTTPS server

// https.createServer(options, app).listen(PORT, () => {
//   console.log(`Secure server running on HTTPS at port ${PORT}`);
// });
