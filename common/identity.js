// Reads who the gateway says the caller is, and checks the role.
module.exports = (role) => (req, res, next) => {
  const id = req.headers['x-user-id'];
  const r = req.headers['x-user-role'];
  if (!id) return res.status(401).json({ message: 'Unauthorized' });
  if (r !== role) return res.status(403).json({ message: `This endpoint is for ${role}s only` });
  req.userId = id;
  next();
};
