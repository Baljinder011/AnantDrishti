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

// Middleware
app.use(cors());
app.use(express.json());


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



// Create Order & Payment Link
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
              // return_url: `http://localhost:${PORT}/redirect.html?orderId=${orderId}&linkId=${linkId}`,
              return_url: `https://indraq.tech/redirect.html?orderId=${orderId}&linkId=${linkId}`,

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















// Create Payment Link API
// app.post("/create-payment-link", async (req, res) => {
//   try {
//     const { customer_name, customer_email, customer_phone, amount } = req.body;

//     if (!customer_name || !customer_email || !customer_phone || !amount) {
//       return res.status(400).json({ error: "Missing required fields" });
//     }

//     const link_id = `CF_${crypto.randomBytes(8).toString("hex")}`;
//     const apiUrl = "https://sandbox.cashfree.com/pg/links";

//     const payload = {
//       order_id,
//       link_id,
//       customer_details: { customer_name, customer_email, customer_phone },
//       link_amount: amount,
//       link_currency: "INR",
//       link_purpose: "E-commerce Purchase",
//       link_notify: { send_email: true, send_sms: true },
//       link_auto_reminders: true,
//       link_expiry_time: getExpiryTime(),
//       link_meta: {
//         return_url: `http://localhost:${PORT}/redirect.html?link_id=${order_id}`

//         // return_url: `http://localhost:${PORT}/redirect.html?link_id=${link_id}`
//         // return_url: `https://indraq.tech/redirect.html?link_id=${link_id}`

//       }
//     };

//     const response = await axios.post(apiUrl, payload, {
//       headers: {
//         "Content-Type": "application/json",
//         "x-api-version": "2022-09-01",
//         "x-client-id": APP_ID,
//         "x-client-secret": SECRET_KEY
//       }
//     });

//     res.json({ link_id: response.data.link_id, link_url: response.data.link_url });
//   } catch (error) {
//     console.error("Cashfree API Error:", error.response?.data || error.message);
//     res.status(500).json({ error: "Failed to create payment link", details: error.response?.data || error.message });
//   }
// });






// // **Check Payment Status**
// app.get("/check-payment-status", async (req, res) => {
//   const linkId = req.query.link_id;
//   if (!linkId) {
//     return res.status(400).json({ error: "Missing Payment Link ID" });
//   }

//   try {
//     // Call Cashfree API
//     const response = await axios.get(`https://sandbox.cashfree.com/pg/links/${linkId}`, {
//       headers: {
//         "x-api-version": "2022-09-01",
//         "x-client-id": APP_ID,
//         "x-client-secret": SECRET_KEY,
//       },
//     });

//     const linkStatus = response.data.link_status;

//     // Determine payment status based on `link_status`
//     let orderStatus = "pending";
//     let paymentStatus = "pending";
//     let paid = false;

//     if (linkStatus === "PAID") {
//       orderStatus = "successful";
//       paymentStatus = "completed";
//       paid = true;
//     } else if (linkStatus === "EXPIRED") {
//       orderStatus = "failed";
//       paymentStatus = "expired";
//     } else if (linkStatus === "CANCELLED") {
//       orderStatus = "failed";
//       paymentStatus = "cancelled";
//     }

//     // Update Order in MongoDB
//     const order = await Order.findOneAndUpdate(
//       { linkId },
//       {
//         status: orderStatus,
//         "paymentDetails.status": paymentStatus,
//         "paymentDetails.paid": paid,
//         "paymentDetails.timestamp": new Date(),
//       },
//       { new: true }
//     );

//     if (!order) {
//       return res.status(404).json({ success: false, message: "Order not found" });
//     }

//     res.json({ success: order.status === "successful", status: order.status });
//   } catch (error) {
//     console.error("Error checking payment status:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//       details: error.response?.data || error.message || "Unknown error occurred",
//     });
//   }
// });



// **Serve Static HTML Pages from "frontend" folder**
// const frontendPath = path.join(__dirname, "../frontend");

// Serve `payment.html`
// app.get("/redirect.html", (req, res) => {
//   res.sendFile(path.join(frontendPath, "redirect.html"), (err) => {
//     if (err) {
//       console.error("Error serving payment.html:", err);
//       res.status(404).send("Payment page not found");
//     }
//   });
// });

// // Serve `success.html`
// app.get("/success.html", (req, res) => {
//   res.sendFile(path.join(frontendPath, "success.html"), (err) => {
//     if (err) {
//       console.error("Error serving success.html:", err);
//       res.status(404).send("Success page not found");
//     }
//   });
// });

// // Serve `failure.html`
// app.get("/failure.html", (req, res) => {
//   res.sendFile(path.join(frontendPath, "failure.html"), (err) => {
//     if (err) {
//       console.error("Error serving failure.html:", err);
//       res.status(404).send("Failure page not found");
//     }
//   });
// });




// Ensure `uploads/Products/` folder exists
const uploadDir = "uploads/Products";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}


// File upload setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // Save to uploads folder
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






// Profile Schema and Model


const profileSchema = new mongoose.Schema({
  name: String,
  email: { type: String, required: true, unique: true },
  phone: String,
  dob: String,
  image: String, // Store image file path
});
profileSchema.index({ email: 1 });
const Profile = mongoose.model("Profile", profileSchema);







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




const addressSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  address: String,
  city: String,
  state: String,
  pin: String,
  country: String,
  isDefaultAddress: Boolean,
});
const Address = mongoose.model("Address", addressSchema);




const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true, minlength: 6 },
  fullName: { type: String, required: true },
  dob: { type: Date, required: true },
  phone: { type: String, required: true, match: /^[0-9]{10}$/ },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);



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

    // Check password (plain text comparison)
    if (user.password !== password) {
      return res.status(400).json({ message: "Invalid password" });
    }

    // Find user profile to get the image (if Profile model exists)
    const profile = await Profile.findOne({ email });

    // Return user profile data with image
    const userProfile = {
      fullName: user.fullName,
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
  console.log("Received request body:", req.body); // Debugging Step 1

  const { email, password, fullName, dob, phone } = req.body;

  if (!email || !password || !fullName || !dob || !phone) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Convert dob to Date object
    const formattedDOB = new Date(dob);
    if (isNaN(formattedDOB.getTime())) {
      return res.status(400).json({ message: "Invalid Date of Birth" });
    }

    // Create and save user
    const newUser = new User({ email, password, fullName, dob: formattedDOB, phone });
    await newUser.save();

    console.log("User saved successfully:", newUser); // Debugging Step 2

    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("Error during registration:", error);
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







app.post("/address", async (req, res) => {
  const { name, email, phone, address, city, state, pin, country, isDefaultAddress } = req.body;
  if (!name || !email || !address || !city || !state || !pin || !country) {
    return res.status(400).json({ message: "All address fields are required" });
  }
  try {
    const newAddress = new Address({
      name,
      email,
      phone,
      address,
      city,
      state,
      pin,
      country,
      isDefaultAddress,
    });
    const savedAddress = await newAddress.save();
    res.status(201).json({ message: "Address saved successfully", savedAddress });
  } catch (error) {
    console.error("Error saving address:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});



app.get("/address", async (req, res) => {
  try {
    const address = await Address.findOne().sort({ _id: -1 }); // Fetch latest address
    if (!address) {
      return res.status(404).json({ success: false, message: "Address not found" });
    }
    res.status(200).json({ success: true, data: address });
  } catch (error) {
    console.error("Error fetching address:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
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











app.post('/products', upload.single('image'), async (req, res) => {
  try {
    const productData = {
      ...req.body,
      price: parseFloat(req.body.price),
      stock: parseInt(req.body.stock),
      discount: parseFloat(req.body.discount),
      image: req.file ? `/uploads/${req.file.filename}` : '',
    };
    const product = new Product(productData);
    await product.save();
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error creating product', error });
  }
});




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
  } catch (error) {
    console.error("Error updating product status:", error);
    res.status(500).json({ message: 'Error updating product status', error });
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

























// User Schema & Model
// const userSchema = new mongoose.Schema({
//   name: String,
//   email: String,
//   phone: String,
//   dob: { type: Date, required: true },
//   password: { type: String, required: true }, // Add this field
//   createdAt: { type: Date, default: Date.now },

//   address: {
//     street: String,
//     city: String,
//     state: String,
//     postalCode: String,
//     country: String
//   },
//   loginSessions: [
//     {
//       date: String,
//       time: String,
//       location: String
//     }
//   ],
//   orders: [
//     {
//       orderId: String,
//       productName: String,
//       price: Number,
//       date: String,
//       status: String
//     }
//   ]
// }, { timestamps: true });

// const Customer = mongoose.model("customer", userSchema);





// Order Schema & Model
// const orderSchema = new mongoose.Schema({
//   productName: String,
//   price: Number,
//   placedOn: Date,
//   status: String,
// });
// const Order = mongoose.model('Order', orderSchema);




//profile schema












// Order Schema
const orderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true }, // Custom Order ID
  linkId: String,
  customerName: String,
  customerEmail: String,
  customerPhone: String,
  orderDetails: Array,
  paymentDetails: {
    method: String,
    amount: Number,
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
      amount,
      status: 'pending'
    });
    await newOrder.save();

    res.json({ success: true, orderId });
  } catch (error) {
    console.error("Error saving order:", error);
    res.status(500).json({ error: "Failed to save order" });
  }
});




// Check Payment Status & Update Order (on redirect page load)
// app.get("/check-payment-status", async (req, res) => {
//   const { linkId } = req.query;
//   if (!linkId) {
//     return res.status(400).json({ success: false, message: "Missing linkId" });
//   }
//   try {
//     const cashfreeResponse = await fetch(`https://api.cashfree.com/api/v1/link/${linkId}`, {
//       method: 'GET',
//       headers: {
//         'x-client-id': process.env.CASHFREE_CLIENT_ID,
//         'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
//         'Content-Type': 'application/json'
//       }
//     });
//     const cashfreeData = await cashfreeResponse.json();
//     if (!cashfreeData || !cashfreeData.link_status) {
//       return res.status(500).json({ success: false, message: "Failed to fetch payment status" });
//     }
//     let orderStatus = 'pending';
//     let paymentStatus = 'pending';
//     let paid = false;
//     if (cashfreeData.link_status === 'PAID') {
//       orderStatus = 'successful';
//       paymentStatus = 'successful';
//       paid = true;
//     } else if (cashfreeData.link_status === 'EXPIRED' || cashfreeData.link_status === 'CANCELLED') {
//       orderStatus = 'failed';
//       paymentStatus = 'failed';
//       paid = false;
//     }
//     // Update Order in MongoDB
//     const order = await Order.findOneAndUpdate(
//       { linkId },
//       {
//         status: orderStatus,
//         'paymentDetails.status': paymentStatus,
//         'paymentDetails.paid': paid,
//         'paymentDetails.timestamp': new Date()
//       },
//       { new: true }
//     );
//     if (!order) {
//       return res.status(404).json({ success: false, message: "Order not found" });
//     }
//     res.json({ success: order.status === 'successful', status: order.status });
//   } catch (error) {
//     console.error("Error checking payment status:", error);
//     res.status(500).json({ success: false, message: "Internal server error" });
//   }
// });







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
