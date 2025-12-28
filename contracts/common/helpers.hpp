#pragma once
#include "../config.hpp"
#include <eosio/contract.hpp>
#include <eosio/transaction.hpp>
#include <eosio/crypto.hpp>
#include "contracts-common/safemath.hpp"
#include "contracts-common/string_format.hpp"
#include <atomicassets-interface.hpp>
#include <atomicdata.hpp>

inline atomicdata::ATTRIBUTE_MAP get_data_with_schema(const name &account, const uint64_t nft_id, const name &schema_name) {
    const auto _assets    = atomicassets::assets_t(NFT_CONTRACT, account.value);
    const auto _templates = atomicassets::templates_t(NFT_CONTRACT, NFT_COLLECTION.value);
    const auto _schemas   = atomicassets::schemas_t(NFT_CONTRACT, NFT_COLLECTION.value);

    const auto nft_itr = _assets.find(nft_id);
    check(nft_itr != _assets.end(), "Owner %s does not own NFT with id %s", account, nft_id);
    const auto &nft = *nft_itr;
    check(nft.schema_name == schema_name, "Invalid schema provided");

    atomicdata::UINT8_VEC      data;
    atomicdata::ATTRIBUTE_MAP  compiled_attrs = {};
    vector<atomicdata::FORMAT> schema         = _schemas.get(schema_name.value, "Schema not found").format;

    // Attributes are merged accoring to Atomic assets precedence rules where template > immutable > mutable.
    if (nft.template_id > -1) {
        // Template Attributes
        data               = _templates.get((uint64_t)nft.template_id, "Could not find template!").immutable_serialized_data;
        auto templateAttrs = atomicdata::deserialize(data, schema);
        compiled_attrs.insert(templateAttrs.begin(), templateAttrs.end());
    }
    // Immutable Attributes
    auto immutable_attrs = atomicdata::deserialize(nft.immutable_serialized_data, schema);
    compiled_attrs.insert(immutable_attrs.begin(), immutable_attrs.end());

    // Mutable Attributes
    auto mutable_attrs = atomicdata::deserialize(nft.mutable_serialized_data, schema);
    compiled_attrs.insert(mutable_attrs.begin(), mutable_attrs.end());

    return compiled_attrs;
}

inline atomicdata::ATTRIBUTE_MAP nft_get_template_data(const name &account, const uint64_t nft_id, const name &schema_name) {
    const auto _assets    = atomicassets::assets_t(NFT_CONTRACT, account.value);
    const auto _templates = atomicassets::templates_t(NFT_CONTRACT, NFT_COLLECTION.value);
    const auto _schemas   = atomicassets::schemas_t(NFT_CONTRACT, NFT_COLLECTION.value);

    const auto nft_itr = _assets.find(nft_id);
    check(nft_itr != _assets.end(), "Owner %s does not own NFT with id %s", account, nft_id);
    const auto &nft = *nft_itr;
    check(nft.schema_name == schema_name, "Invalid schema provided");
    check(nft.template_id > -1, "ERR:NO_TEMPLATE NFT does not derived from a template, this should not be possible");
    const auto schema = _schemas.get(nft.schema_name.value, "Schema not found").format;

    const auto data = _templates.get(nft.template_id, "Could not find template!").immutable_serialized_data;
    return atomicdata::deserialize(data, schema);
}

inline atomicdata::ATTRIBUTE_MAP nft_get_mutable_data(const name &account, const uint64_t nft_id, const name &schema_name) {
    auto _assets    = atomicassets::assets_t(NFT_CONTRACT, account.value);
    auto _templates = atomicassets::templates_t(NFT_CONTRACT, NFT_COLLECTION.value);
    auto _schemas   = atomicassets::schemas_t(NFT_CONTRACT, NFT_COLLECTION.value);

    const auto nft_itr = _assets.find(nft_id);
    check(nft_itr != _assets.end(), "Owner %s does not own NFT with id %s", account, nft_id);
    const auto &nft = *nft_itr;
    check(nft.schema_name == schema_name, "Invalid schema provided");

    const auto format = _schemas.get(schema_name.value, "Schema not found").format;
    return atomicdata::deserialize(nft.mutable_serialized_data, format);
}

template <typename T>
inline auto nft_get_attr(const name &owner, const uint64_t nft_id, const string &attr_name) {
    const auto nft_data = get_data_with_schema(owner, nft_id, LAND_SCHEMA);
    const auto attr     = nft_data.find(attr_name);
    check(attr != nft_data.end(), "No %s found in NFT for nft_id: %s owner: %s", attr_name, nft_id, owner);
    return std::get<T>(attr->second);
}

template <typename T>
inline auto nft_get_attr(const atomicdata::ATTRIBUTE_MAP &nft_data, const string &attr_name) {
    const auto attr = nft_data.find(attr_name);
    check(attr != nft_data.end(), "Attr %s not found in NFT", attr_name);
    return std::get<T>(attr->second);
}

template <typename T>
inline optional<T> nft_get_attr_optional(const atomicdata::ATTRIBUTE_MAP &nft_data, const string &attr_name) {
    const auto attr = nft_data.find(attr_name);
    if (attr != nft_data.end()) {
        return std::get<T>(attr->second);
    } else {
        return {};
    }
}

inline void nft_update_mutable_data(
    const permission_level &p, const name &authorized_editor, const name &owner, const uint64_t land_id, const atomicdata::ATTRIBUTE_MAP &attrs) {
    auto data = nft_get_mutable_data(owner, land_id, LAND_SCHEMA);
    for (const auto &[key, value] : attrs) {
        data[key] = value;
    }

    action(p, NFT_CONTRACT, "setassetdata"_n, make_tuple(authorized_editor, owner, land_id, data)).send();
}

inline uint32_t time_now() {
    return current_time_point().sec_since_epoch();
}

inline checksum256 get_trxid(const std::vector<char> &buffer) {
    return sha256(buffer.data(), buffer.size());
}

inline std::vector<char> get_trx_data() {
    const auto size   = transaction_size();
    auto       buffer = std::vector<char>(size);
    const auto read   = read_transaction(buffer.data(), size);
    check(size == read, "ERR::READ_TRANSACTION_FAILED::read_transaction failed");
    return buffer;
}

inline asset TLM(const int64_t currency_amount) {
    static constexpr auto factor = S{int64_t{10'000}};
    return asset{S{currency_amount} * factor, TLM_SYM};
}

name planet_auth(const name planet) {
#ifndef IS_DEV
    // check(false, "Unauthorized"); // This line is temporary until we allow the planets to whitelist.
#endif
    const map<name, name> const_lookups = {{"eyeke.world"_n, "eyeke.dac"_n}, {"kavian.world"_n, "kavian.dac"_n}, {"magor.world"_n, "magor.dac"_n},
        {"naron.world"_n, "naron.dac"_n}, {"neri.world"_n, "neri.dac"_n}, {"veles.world"_n, "veles.dac"_n}};

    const auto auth = const_lookups.find(planet);
    check(auth != const_lookups.end(), "ERR::UNKNOWN_PLANET::Unknown planet '%s'.", planet);
    return auth->second;
}