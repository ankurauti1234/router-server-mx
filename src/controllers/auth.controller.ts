import { dataSource } from "../config/dataSource.js";
import { hashPassword, comparePassword } from "../utils/hash.js";
import jwt, { SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";
import { User } from "../entities/user.entities.js";
import type { Request, Response } from "express";
const JWT_SECRET = process.env.JWT_SECRET as string;


const userRepo = dataSource.getRepository("User");

// REGISTER
export const register = async (req: Request, res: Response) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: "Name, email, and password required" });

    const existing = await userRepo.findOne({ where: { email } });
    if (existing) return res.status(409).json({ message: "Email already registered" });

    const password_hash = await hashPassword(password);

    const user = userRepo.create({ name, email, password_hash });
    await userRepo.save(user);

    const token = jwt.sign(
        { id: user.id, email: user.email },
        JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN ?? '1h' } as SignOptions
    );

    res.status(201).json({ user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// LOGIN
export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email and password required" });

    const user = await userRepo.findOne({ where: { email } });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const isValid = await comparePassword(password, user.password_hash);
    if (!isValid) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign(
        { id: user.id, email: user.email },
        JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN ?? '1h' } as SignOptions
    );

    const isProduction = process.env.NODE_ENV === "production";

    res.cookie("auth-session", token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      path: "/",
      maxAge: 60 * 60 * 1000
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const logout = (req: Request, res: Response) => {
  res.clearCookie("auth-session", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "none",
    path: "/"
  });

  res.json({ success: true });
};