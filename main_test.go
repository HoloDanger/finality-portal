package main

import (
	"crypto/aes"
	"crypto/cipher"
	"net/http"
	"net/http/httptest"
	"testing"
)

// BenchmarkFetchLetterEndpoint measures the latency and allocations of the new zero-trust /api/letter GET endpoint.
func BenchmarkFetchLetterEndpoint(b *testing.B) {
	initExpirationTime()

	// Use one of the new PBKDF2 stretched lookup keys from main.go database
	authKeyHex := "35fe1c35aef9294a9021332f58843220ab72af81de7c58b9b07eca0fb06fa8e2"

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		status := getStatus()
		if status.IsExpired {
			w.WriteHeader(http.StatusGone)
			return
		}

		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}

		id := r.URL.Query().Get("id")
		encLetter, found := database[id]
		if !found {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Write envelope payload
		w.Write([]byte(`{"nonce":"` + encLetter.Nonce + `","ciphertext":"` + encLetter.Ciphertext + `"}`))
	})

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest("GET", "/api/letter?id="+authKeyHex, nil)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			b.Fatalf("Expected 200 OK, got %d", w.Code)
		}
	}
}

// BenchmarkAESGCMOnly measures the raw cryptographic decryption speed of AES-GCM.
func BenchmarkAESGCMOnly(b *testing.B) {
	cryptKey := make([]byte, 32)
	nonceBytes := make([]byte, 12)
	plaintext := []byte("Benchmark AES-GCM decryption throughput latency validation.")

	block, _ := aes.NewCipher(cryptKey)
	aesGCM, _ := cipher.NewGCM(block)
	ciphertextBytes := aesGCM.Seal(nil, nonceBytes, plaintext, nil)

	b.ResetTimer()
	b.ReportAllocs()

	var dst []byte
	var err error
	for i := 0; i < b.N; i++ {
		dst, err = aesGCM.Open(dst[:0], nonceBytes, ciphertextBytes, nil)
		if err != nil {
			b.Fatal(err)
		}
	}
}
