class RandomnessProvider {
  public:
    RandomnessProvider(checksum256 random_seed) {
        raw_values = random_seed.extract_as_byte_array();
        offset     = 0;
    }

    uint64_t get_uint64() {
        if (offset > 24) {
            regenerate_raw_values();
        }

        uint64_t value = 0;
        for (int i = 0; i < 8; i++) {
            value = (value << 8) + raw_values[offset];
            offset++;
        }
        return value;
    }

    uint32_t get_uint32() {
        if (offset > 24) {
            regenerate_raw_values();
        }

        uint32_t value = 0;
        for (int i = 0; i < 4; i++) {
            value = (value << 8) + raw_values[offset];
            offset++;
        }
        return value;
    }

    uint16_t get_uint16() {
        if (offset > 24) {
            regenerate_raw_values();
        }

        uint16_t value = 0;
        for (int i = 0; i < 2; i++) {
            value = (value << 8) + raw_values[offset];
            offset++;
        }
        return value;
    }

    uint8_t get_uint8() {
        if (offset > 24) {
            regenerate_raw_values();
        }

        uint8_t value = raw_values[offset];
        offset++;

        return value;
    }

  private:
    void regenerate_raw_values() {
        checksum256 new_hash = eosio::sha256((char *)raw_values.data(), 32);
        raw_values           = new_hash.extract_as_byte_array();
        offset               = 0;
    }

    array<uint8_t, 32> raw_values;
    int                offset;
};
