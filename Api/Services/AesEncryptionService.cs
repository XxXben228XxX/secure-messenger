using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

public class AesEncryptionService : IDisposable
{
    private readonly Aes _aes;

    public AesEncryptionService(string keyBase64, string ivBase64)
    {
        var key = Convert.FromBase64String(keyBase64);
        var iv = Convert.FromBase64String(ivBase64);

        if (key.Length != 32)
            throw new ArgumentException("Key must be 32 bytes long after Base64 decoding.");
        if (iv.Length != 16)
            throw new ArgumentException("IV must be 16 bytes long after Base64 decoding.");

        _aes = Aes.Create();
        _aes.Key = key;
        _aes.IV = iv;
        _aes.Mode = CipherMode.CBC;
        _aes.Padding = PaddingMode.PKCS7;
    }

    public string Encrypt(string plainText)
    {
        byte[] plainBytes = Encoding.UTF8.GetBytes(plainText);

        using (var encryptor = _aes.CreateEncryptor())
        using (var ms = new MemoryStream())
        {
            using (var cs = new CryptoStream(ms, encryptor, CryptoStreamMode.Write))
            {
                cs.Write(plainBytes, 0, plainBytes.Length);
                cs.FlushFinalBlock();
            }
            return Convert.ToBase64String(ms.ToArray());
        }
    }

    public string Decrypt(string cipherText)
    {
        byte[] encryptedData = Convert.FromBase64String(cipherText);

        using (var decryptor = _aes.CreateDecryptor())
        using (var ms = new MemoryStream(encryptedData))
        using (var cs = new CryptoStream(ms, decryptor, CryptoStreamMode.Read))
        using (var resultStream = new MemoryStream())
        {
            try
            {
                cs.CopyTo(resultStream);
                return Encoding.UTF8.GetString(resultStream.ToArray());
            }
            catch (CryptographicException ex)
            {
                Console.WriteLine($"Decryption failed: {ex.Message}");
                throw new CryptographicException("Failed to decrypt data. Check key/IV and ensure data integrity", ex);
            }
        }
    }

    public void Dispose()
    {
        _aes?.Dispose();
    }
}