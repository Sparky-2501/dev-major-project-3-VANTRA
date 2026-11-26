const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');


const userSchema = new mongoose.Schema({
    fullname:{
        firstname:{
            type:String,
            required: true,
            minlength:[2,'First name must be atleast 2 characters']
        },
        lastname:{
            type:String,
            minlength:[2,'Last name must be atleast 2 characters']
        }
    },
    email:{
        type:String,
        required:true,
        unique:true,
        minlength:[5,'Email  must be atleast size of 5']
    },
    password:{
        type:String,
        required:true,  // we will use jwt auth for more security 
        select:false
    },
    socketId:{
        type:String
    }
}, {
    // select:false only hides the password from QUERIES. A document returned by
    // create(), or by a query that used .select('+password'), still carries the
    // hash, and res.json() would send it to the client. This strips it everywhere.
    toJSON: {
        transform: (doc, ret) => {
            delete ret.password;
            delete ret.__v;
            return ret;
        }
    }
})

// `role` stops a rider token being accepted on driver routes (and vice versa).
userSchema.methods.generateAuthToken = function(){
    const token = jwt.sign({_id: this._id, role: 'user'}, process.env.JWT_SECRET, { expiresIn: '24h' });
    return token;
}

userSchema.methods.comparePassword = async function(password){
    return await bcrypt.compare(password, this.password);
}

userSchema.statics.hashPassword = async function(password){
    return await bcrypt.hash(password, 10);
}

const userModel = mongoose.model('user', userSchema);

module.exports = userModel;