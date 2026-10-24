package pl.pichkur.tvhome;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.RSAPublicKeySpec;
import java.security.interfaces.RSAPrivateCrtKey;
import android.util.Base64;

import javax.crypto.Cipher;

/**
 * A tiny ADB client for the box's own network debugging (127.0.0.1:5555): the phone remote uses it
 * to send arrow/OK keys to other apps, which a normal app cannot do. No libraries — just the ADB
 * wire protocol (CNXN / AUTH / OPEN "shell:" / WRTE / CLSE). The first connection makes Android ask
 * "Allow debugging?" on the TV once; after "Always allow" it is silent.
 */
final class AdbLocal {
    private static final int A_CNXN = 0x4e584e43, A_AUTH = 0x48545541, A_OPEN = 0x4e45504f, A_OKAY = 0x59414b4f,
            A_CLSE = 0x45534c43, A_WRTE = 0x45545257;
    private static final int VERSION = 0x01000000, MAXDATA = 256 * 1024;
    // DER prefix of a SHA-1 DigestInfo: adbd checks a PKCS#1 v1.5 signature of the token as if it were a SHA-1 digest
    private static final byte[] SHA1_PREFIX = { 0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14 };

    private final KeyPair keys;
    private final String name;

    AdbLocal(KeyPair keys, String name) { this.keys = keys; this.name = name; }

    /** Loads the key pair from {@code dir}/adbkey (PKCS#8 DER), creating one on first use. */
    static KeyPair loadOrCreate(File dir) throws Exception {
        File f = new File(dir, "adbkey.der");
        KeyFactory kf = KeyFactory.getInstance("RSA");
        if (f.exists()) {
            byte[] der = readAll(f);
            RSAPrivateCrtKey priv = (RSAPrivateCrtKey) kf.generatePrivate(new PKCS8EncodedKeySpec(der));
            RSAPublicKey pub = (RSAPublicKey) kf.generatePublic(new RSAPublicKeySpec(priv.getModulus(), priv.getPublicExponent()));
            return new KeyPair(pub, priv);
        }
        KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
        g.initialize(2048);
        KeyPair kp = g.generateKeyPair();
        try (FileOutputStream o = new FileOutputStream(f)) { o.write(kp.getPrivate().getEncoded()); }
        return kp;
    }

    /** Android's own public key format (the mincrypt RSAPublicKey struct, base64) + " name". */
    static String publicKeyString(RSAPublicKey pub, String name) {
        BigInteger n = pub.getModulus();
        int words = 64; // 2048-bit
        BigInteger r32 = BigInteger.ONE.shiftLeft(32);
        BigInteger n0inv = n.mod(r32).modInverse(r32).negate().mod(r32);
        BigInteger rr = BigInteger.ONE.shiftLeft(words * 32).pow(2).mod(n);
        ByteBuffer b = ByteBuffer.allocate(4 + 4 + words * 4 + words * 4 + 4).order(ByteOrder.LITTLE_ENDIAN);
        b.putInt(words);
        b.putInt(n0inv.intValue());
        putWords(b, n, words);
        putWords(b, rr, words);
        b.putInt(pub.getPublicExponent().intValue());
        return Base64.encodeToString(b.array(), Base64.NO_WRAP) + " " + name;
    }

    private static void putWords(ByteBuffer b, BigInteger v, int words) {
        BigInteger mask = BigInteger.ONE.shiftLeft(32).subtract(BigInteger.ONE);
        for (int i = 0; i < words; i++) { b.putInt(v.and(mask).intValue()); v = v.shiftRight(32); }
    }

    private byte[] sign(byte[] token) throws Exception {
        Cipher c = Cipher.getInstance("RSA/ECB/PKCS1Padding");
        c.init(Cipher.ENCRYPT_MODE, (RSAPrivateKey) keys.getPrivate());
        byte[] in = new byte[SHA1_PREFIX.length + token.length];
        System.arraycopy(SHA1_PREFIX, 0, in, 0, SHA1_PREFIX.length);
        System.arraycopy(token, 0, in, SHA1_PREFIX.length, token.length);
        return c.doFinal(in);
    }

    // ---------- one connection per command (keys are rare; this keeps state trivial) ----------
    private static final class Msg { int cmd, a0, a1; byte[] data; }

    private static void send(OutputStream o, int cmd, int a0, int a1, byte[] data) throws IOException {
        if (data == null) data = new byte[0];
        long sum = 0;
        for (byte x : data) sum += x & 0xff;
        ByteBuffer h = ByteBuffer.allocate(24).order(ByteOrder.LITTLE_ENDIAN);
        h.putInt(cmd).putInt(a0).putInt(a1).putInt(data.length).putInt((int) sum).putInt(cmd ^ 0xffffffff);
        o.write(h.array());
        o.write(data);
        o.flush();
    }

    private static Msg read(DataInputStream in) throws IOException {
        byte[] hb = new byte[24];
        in.readFully(hb);
        ByteBuffer h = ByteBuffer.wrap(hb).order(ByteOrder.LITTLE_ENDIAN);
        Msg m = new Msg();
        m.cmd = h.getInt(); m.a0 = h.getInt(); m.a1 = h.getInt();
        int len = h.getInt();
        m.data = new byte[len];
        in.readFully(m.data);
        return m;
    }

    /**
     * Runs a shell command and returns its output. Throws if the box refused (debugging off) or the
     * user hasn't allowed this key yet ({@code waitAuthMs} = how long to wait for that dialog).
     */
    String shell(String host, int port, String cmd, int waitAuthMs) throws Exception {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(host, port), 1500);
            s.setSoTimeout(Math.max(4000, waitAuthMs));
            DataInputStream in = new DataInputStream(s.getInputStream());
            OutputStream out = s.getOutputStream();
            send(out, A_CNXN, VERSION, MAXDATA, "host::\0".getBytes(StandardCharsets.UTF_8));
            boolean sentSig = false, sentKey = false;
            while (true) {
                Msg m = read(in);
                if (m.cmd == A_CNXN) break;
                if (m.cmd != A_AUTH) throw new IOException("unexpected " + Integer.toHexString(m.cmd));
                if (m.a0 == 1 && !sentSig) { send(out, A_AUTH, 2, 0, sign(m.data)); sentSig = true; continue; }
                if (m.a0 == 1 && !sentKey) {
                    send(out, A_AUTH, 3, 0, (publicKeyString((RSAPublicKey) keys.getPublic(), name) + "\0").getBytes(StandardCharsets.UTF_8));
                    sentKey = true;
                    continue;
                }
                throw new IOException("auth refused");
            }
            s.setSoTimeout(Math.max(6000, waitAuthMs)); // long commands (pm install) may take a while
            int local = 1;
            send(out, A_OPEN, local, 0, ("shell:" + cmd + "\0").getBytes(StandardCharsets.UTF_8));
            ByteArrayOutputStream result = new ByteArrayOutputStream();
            int remote = 0;
            while (true) {
                Msg m = read(in);
                if (m.cmd == A_OKAY) { remote = m.a0; continue; }
                if (m.cmd == A_WRTE) { result.write(m.data); send(out, A_OKAY, local, m.a0, null); continue; }
                if (m.cmd == A_CLSE) { send(out, A_CLSE, local, remote == 0 ? m.a0 : remote, null); break; }
            }
            return result.toString("UTF-8");
        }
    }

    private static byte[] readAll(File f) throws IOException {
        try (FileInputStream i = new FileInputStream(f)) {
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            for (int k; (k = i.read(buf)) > 0; ) o.write(buf, 0, k);
            return o.toByteArray();
        }
    }
}
