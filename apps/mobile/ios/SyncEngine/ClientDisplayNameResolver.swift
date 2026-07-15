import Foundation

func lynavoGenericClientName(_ rawName: String, model: String) -> Bool {
    let normalized = rawName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if normalized.isEmpty {
        return true
    }
    let genericNames = [
        "iphone",
        "ipad",
        "ipod",
        "ipod touch",
        model.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
    ]
    return genericNames.contains(normalized)
}

func lynavoLegacyGeneratedClientName(_ rawName: String, model: String, clientId: String?) -> Bool {
    let trimmedName = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
    let trimmedModel = model.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedName.isEmpty, !trimmedModel.isEmpty else {
        return false
    }

    let normalizedClientId = (clientId ?? "")
        .replacingOccurrences(of: "-", with: "")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    guard normalizedClientId.count >= 4 else {
        return false
    }

    let suffix = String(normalizedClientId.suffix(4)).uppercased()
    return trimmedName == "\(trimmedModel) \(suffix)"
}

func lynavoResolvedDefaultClientDisplayName(rawName: String, model: String) -> String {
    let trimmedName = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
    guard lynavoGenericClientName(trimmedName, model: model) else {
        return trimmedName
    }

    let trimmedModel = model.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmedModel.isEmpty ? trimmedName : trimmedModel
}

func lynavoResolvedClientDisplayName(
    storedName: String?,
    legacyName: String?,
    rawName: String,
    model: String,
    clientId: String?
) -> String {
    if let stored = lynavoResolvedCustomClientDisplayName(storedName, model: model, clientId: clientId) {
        return stored
    }
    if let legacy = lynavoResolvedCustomClientDisplayName(legacyName, model: model, clientId: clientId) {
        return legacy
    }
    return lynavoResolvedDefaultClientDisplayName(rawName: rawName, model: model)
}

private func lynavoResolvedCustomClientDisplayName(_ name: String?, model: String, clientId: String?) -> String? {
    guard let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines),
          !trimmed.isEmpty,
          !lynavoGenericClientName(trimmed, model: model),
          !lynavoLegacyGeneratedClientName(trimmed, model: model, clientId: clientId)
    else {
        return nil
    }
    return trimmed
}
