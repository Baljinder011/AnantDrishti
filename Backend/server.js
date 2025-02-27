const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const multer = require("multer");
const path = require("path");
const bcrypt = require("bcrypt");
require('dotenv').config();
const crypto = require("crypto");
const axios= require("axios")



const app = express();

// Middleware
app.use(cors({ origin: "*" }));

const frontendPath = path.join(__dirname, "..", "Frontend"); // Adjust if needed
console.log("Serving frontend from:", frontendPath); // Debugging
app.use(express.static(frontendPath));
app.use(bodyParser.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));



const PORT = process.env.PORT || 3000






// MongoDB connection

const uri = "mongodb://localhost:27017/AnantDrishti";
mongoose
  .connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })
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

// API to Create a Payment Link
app.post("/create-payment-link", async (req, res) => {
    try {
        const { customer_name, customer_email, customer_phone, amount } = req.body;
        if (!customer_name || !customer_email || !customer_phone || !amount) {
            return res.status(400).json({ error: "Missing required fields" });
        }
        
        // Generate a unique link_id (Order ID)
        const link_id = `CF_${crypto.randomBytes(8).toString("hex")}`;
        const apiUrl = "https://sandbox.cashfree.com/pg/links";
        const payload = {
            link_id: link_id,
            customer_details: {
                customer_name,
                customer_email,
                customer_phone
            },
            link_amount: amount,
            link_currency: "INR",
            link_purpose: "E-commerce Purchase",
            link_notify: { send_email: true, send_sms: true },
            link_auto_reminders: true,
            link_expiry_time: getExpiryTime(),
            link_meta: {
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

        res.json({
            link_id: response.data.link_id,
            link_url: response.data.link_url
        });
    } catch (error) {
        res.status(500).json({
            error: "Failed to create payment link",
            details: error.response?.data || error.message || "Unknown error occurred"
        });
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
  destination: (req, file, cb) => {cb(null, "uploads/"); // Save to uploads folder
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
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true, minlength: 6 },
  fullName: { type: String, required: true },
  dob: { type: Date, required: true },
  phone: { type: String, required: true, match: /^[0-9]{10}$/ }, // Validates for 10 digits
  createdAt: { type: Date, default: Date.now },
});

userSchema.index({ email: 1 });  // Indexing email for faster queries
const User = mongoose.model("User", userSchema);



// Profile Schema and Model
const profileSchema = new mongoose.Schema({
  name: String,
  email: { type: String, required: true, unique: true },
  phone: String,
  dob: String,
  image: String, // Store image file path
});
profileSchema.index({ email: 1 });  // Indexing email for faster queries
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





// Address Schema and Model
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













// Register route with password hashing and validation
app.post("/register", async (req, res) => {
  const { email, password, fullName, dob, phone } = req.body;

  // Ensure that all required fields are provided
  if (!email || !password || !fullName || !dob || !phone) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Hash the password using bcrypt
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user with hashed password and other details
    const newUser = new User({ email, password: hashedPassword, fullName, dob, phone });

    // Save the new user to the database
    await newUser.save();

    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});






// Login route with email and password check
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
      const user = await User.findOne({ email });
      if (!user) {
          return res.status(400).json({ message: 'User not found' });
      }

      const match = await bcrypt.compare(password, user.password);
      if (!match) {
          return res.status(400).json({ message: 'Invalid password' });
      }

      // Return user profile data without password
      const userProfile = {
          name: user.fullName,
          email: user.email,
          dob: user.dob,
          phone: user.phone
      };
      res.json({ message: 'Login successful', userProfile });
  } catch (error) {
      res.status(500).json({ message: 'Server error' });
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










// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
